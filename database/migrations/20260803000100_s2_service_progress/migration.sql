-- S2 student service progress: blocking snapshots, stage state, automatic
-- progress summaries, manual tasks and append-only calculation history.

CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');
CREATE TYPE "TaskSourceType" AS ENUM ('SOP', 'MANUAL');
CREATE TYPE "ProgressCalculationStatus" AS ENUM ('NORMAL', 'RECALCULATING', 'ERROR');
CREATE TYPE "StageTransitionTriggerType" AS ENUM (
  'SERVICE_ACTIVATION',
  'TASK_COMPLETED',
  'TASK_CANCELED',
  'CONTINUOUS_ADVANCE',
  'MIGRATION',
  'RECALCULATION'
);
CREATE TYPE "ProgressCalculationRunType" AS ENUM ('MIGRATION', 'RECALCULATION');
CREATE TYPE "ProgressCalculationRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

INSERT INTO "permissions" ("permission_code", "permission_name", "description")
VALUES ('students.own.read', '查看本人负责学生的服务进度', '按当前默认管家实施服务端行级过滤')
ON CONFLICT ("permission_code") DO UPDATE SET
  "permission_name" = EXCLUDED."permission_name",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
JOIN "permissions" permission ON permission."permission_code" = 'students.own.read'
WHERE role."role_code" = 'BUTLER'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

ALTER TABLE "sop_task_templates"
  ADD COLUMN "is_blocking" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "stage_instances"
  ADD COLUMN "status" "StageStatus" NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3),
  ADD COLUMN "completion_reason" VARCHAR(500),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "student_service_activations"
  ADD COLUMN "current_stage_instance_id" UUID,
  ADD COLUMN "completed_stage_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progress_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "calculation_status" "ProgressCalculationStatus" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "calculation_error_code" VARCHAR(64),
  ADD COLUMN "last_calculated_at" TIMESTAMP(3);

ALTER TABLE "task_instances"
  ADD COLUMN "source_type" "TaskSourceType" NOT NULL DEFAULT 'SOP',
  ADD COLUMN "is_blocking_snapshot" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "created_by" UUID,
  ALTER COLUMN "task_template_id" DROP NOT NULL,
  ALTER COLUMN "completion_window_hours_snapshot" DROP NOT NULL;

CREATE TABLE "service_progress_calculation_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "service_activation_id" UUID NOT NULL,
  "type" "ProgressCalculationRunType" NOT NULL,
  "status" "ProgressCalculationRunStatus" NOT NULL DEFAULT 'RUNNING',
  "initiated_by" UUID,
  "request_id" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(128),
  "change_summary" JSONB,
  "error_code" VARCHAR(64),
  "error_summary" VARCHAR(1000),
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "service_progress_calculation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stage_transitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stage_instance_id" UUID NOT NULL,
  "from_status" "StageStatus",
  "to_status" "StageStatus" NOT NULL,
  "trigger_type" "StageTransitionTriggerType" NOT NULL,
  "trigger_task_id" UUID,
  "summary" VARCHAR(500) NOT NULL,
  "calculation_run_id" UUID,
  "deduplication_key" VARCHAR(255) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stage_transitions_pkey" PRIMARY KEY ("id")
);

-- Existing S1 templates and task instances are intentionally migrated as
-- blocking SOP work so no historical stage can advance early.
UPDATE "sop_task_templates" SET "is_blocking" = TRUE;
UPDATE "task_instances"
SET "source_type" = 'SOP', "is_blocking_snapshot" = TRUE;

-- Derive the completed prefix for every enabled student. Completion time is
-- the latest terminal task time seen through that stage, clamped to activation
-- and prior-stage completion so the resulting history never moves backwards.
WITH stage_facts AS (
  SELECT
    stage."id",
    stage."service_activation_id",
    stage."sequence_no_snapshot",
    activation."enabled_at",
    (
      EXISTS (
        SELECT 1 FROM "task_instances" blocking
        WHERE blocking."stage_instance_id" = stage."id"
          AND blocking."is_blocking_snapshot" = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM "task_instances" active
        WHERE active."stage_instance_id" = stage."id"
          AND active."is_blocking_snapshot" = TRUE
          AND active."status" IN ('TODO', 'IN_PROGRESS')
      )
    ) AS "all_terminal",
    (
      SELECT MAX(COALESCE(task."completed_at", task."canceled_at", task."updated_at"))
      FROM "task_instances" task
      WHERE task."stage_instance_id" = stage."id"
        AND task."is_blocking_snapshot" = TRUE
        AND task."status" IN ('COMPLETED', 'CANCELED')
    ) AS "raw_completed_at"
  FROM "stage_instances" stage
  JOIN "student_service_activations" activation
    ON activation."id" = stage."service_activation_id"
), prefix_progress AS (
  SELECT
    facts.*,
    BOOL_AND(facts."all_terminal") OVER (
      PARTITION BY facts."service_activation_id"
      ORDER BY facts."sequence_no_snapshot"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "is_completed_prefix"
  FROM stage_facts facts
), effective_times AS (
  SELECT
    progress.*,
    GREATEST(
      progress."enabled_at",
      MAX(progress."raw_completed_at") FILTER (WHERE progress."is_completed_prefix") OVER (
        PARTITION BY progress."service_activation_id"
        ORDER BY progress."sequence_no_snapshot"
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    ) AS "effective_completed_at",
    GREATEST(
      progress."enabled_at",
      MAX(progress."raw_completed_at") FILTER (WHERE progress."is_completed_prefix") OVER (
        PARTITION BY progress."service_activation_id"
        ORDER BY progress."sequence_no_snapshot"
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      )
    ) AS "previous_completed_at",
    MIN(progress."sequence_no_snapshot") FILTER (WHERE NOT progress."is_completed_prefix") OVER (
      PARTITION BY progress."service_activation_id"
    ) AS "first_incomplete_sequence"
  FROM prefix_progress progress
)
UPDATE "stage_instances" stage
SET
  "status" = CASE
    WHEN times."is_completed_prefix" THEN 'COMPLETED'::"StageStatus"
    WHEN times."sequence_no_snapshot" = times."first_incomplete_sequence" THEN 'IN_PROGRESS'::"StageStatus"
    ELSE 'NOT_STARTED'::"StageStatus"
  END,
  "started_at" = CASE
    WHEN times."is_completed_prefix"
      OR times."sequence_no_snapshot" = times."first_incomplete_sequence"
    THEN CASE
      WHEN times."sequence_no_snapshot" = 1 THEN times."enabled_at"
      ELSE times."previous_completed_at"
    END
    ELSE NULL
  END,
  "completed_at" = CASE
    WHEN times."is_completed_prefix" THEN times."effective_completed_at"
    ELSE NULL
  END,
  "completion_reason" = CASE
    WHEN times."is_completed_prefix" THEN '历史数据迁移'
    ELSE NULL
  END,
  "version" = CASE WHEN times."is_completed_prefix" THEN 2
    WHEN times."sequence_no_snapshot" = times."first_incomplete_sequence" THEN 1
    ELSE 0 END
FROM effective_times times
WHERE stage."id" = times."id";

UPDATE "student_service_activations" activation
SET
  "current_stage_instance_id" = (
    SELECT stage."id"
    FROM "stage_instances" stage
    WHERE stage."service_activation_id" = activation."id"
      AND stage."status" = 'IN_PROGRESS'
    ORDER BY stage."sequence_no_snapshot"
    LIMIT 1
  ),
  "completed_stage_count" = (
    SELECT COUNT(*)::INTEGER
    FROM "stage_instances" completed
    WHERE completed."service_activation_id" = activation."id"
      AND completed."status" = 'COMPLETED'
  ),
  "progress_version" = 1,
  "calculation_status" = 'NORMAL',
  "calculation_error_code" = NULL,
  "last_calculated_at" = CURRENT_TIMESTAMP
;

-- Do not expose a guessed stage for structurally invalid S1 data. The raw task
-- facts remain untouched and the administrator can use the controlled S2
-- recalculation flow after repairing the structural issue.
WITH anomalous_activations AS (
  SELECT activation."id"
  FROM "student_service_activations" activation
  LEFT JOIN "stage_instances" stage
    ON stage."service_activation_id" = activation."id"
  GROUP BY activation."id"
  HAVING COUNT(stage."id") <> 8
    OR COUNT(DISTINCT stage."sequence_no_snapshot") <> 8
    OR MIN(stage."sequence_no_snapshot") <> 1
    OR MAX(stage."sequence_no_snapshot") <> 8
    OR EXISTS (
      SELECT 1
      FROM "stage_instances" candidate
      WHERE candidate."service_activation_id" = activation."id"
        AND NOT EXISTS (
          SELECT 1
          FROM "task_instances" task
          WHERE task."stage_instance_id" = candidate."id"
        )
    )
    OR EXISTS (
      SELECT 1
      FROM "task_instances" task
      JOIN "stage_instances" task_stage ON task_stage."id" = task."stage_instance_id"
      WHERE task."service_activation_id" = activation."id"
        AND (
          task_stage."service_activation_id" <> task."service_activation_id"
          OR task_stage."student_id" <> task."student_id"
        )
    )
)
UPDATE "stage_instances" stage
SET
  "status" = 'NOT_STARTED',
  "started_at" = NULL,
  "completed_at" = NULL,
  "completion_reason" = NULL,
  "version" = 0
FROM anomalous_activations anomaly
WHERE stage."service_activation_id" = anomaly."id";

WITH anomalous_activations AS (
  SELECT activation."id"
  FROM "student_service_activations" activation
  LEFT JOIN "stage_instances" stage
    ON stage."service_activation_id" = activation."id"
  GROUP BY activation."id"
  HAVING COUNT(stage."id") <> 8
    OR COUNT(DISTINCT stage."sequence_no_snapshot") <> 8
    OR MIN(stage."sequence_no_snapshot") <> 1
    OR MAX(stage."sequence_no_snapshot") <> 8
    OR EXISTS (
      SELECT 1
      FROM "stage_instances" candidate
      WHERE candidate."service_activation_id" = activation."id"
        AND NOT EXISTS (
          SELECT 1
          FROM "task_instances" task
          WHERE task."stage_instance_id" = candidate."id"
        )
    )
    OR EXISTS (
      SELECT 1
      FROM "task_instances" task
      JOIN "stage_instances" task_stage ON task_stage."id" = task."stage_instance_id"
      WHERE task."service_activation_id" = activation."id"
        AND (
          task_stage."service_activation_id" <> task."service_activation_id"
          OR task_stage."student_id" <> task."student_id"
        )
    )
)
UPDATE "student_service_activations" activation
SET
  "current_stage_instance_id" = NULL,
  "completed_stage_count" = 0,
  "calculation_status" = 'ERROR',
  "calculation_error_code" = 'SERVICE_PROGRESS_INCONSISTENT',
  "last_calculated_at" = NULL
FROM anomalous_activations anomaly
WHERE activation."id" = anomaly."id";

INSERT INTO "service_progress_calculation_runs" (
  "service_activation_id",
  "type",
  "status",
  "request_id",
  "idempotency_key",
  "change_summary",
  "error_code",
  "error_summary",
  "completed_at"
)
SELECT
  activation."id",
  'MIGRATION',
  CASE
    WHEN activation."calculation_status" = 'ERROR'
      THEN 'FAILED'::"ProgressCalculationRunStatus"
    ELSE 'COMPLETED'::"ProgressCalculationRunStatus"
  END,
  'migration:20260803000100',
  'migration:20260803000100',
  jsonb_build_object(
    'completedStageCount', activation."completed_stage_count",
    'currentStageInstanceId', activation."current_stage_instance_id",
    'source', 'S1_TO_S2',
    'calculationStatus', activation."calculation_status"
  ),
  CASE
    WHEN activation."calculation_status" = 'ERROR'
      THEN 'SERVICE_PROGRESS_INCONSISTENT'
    ELSE NULL
  END,
  CASE
    WHEN activation."calculation_status" = 'ERROR'
      THEN '历史阶段数量、顺序或任务关联异常，迁移未生成猜测进度'
    ELSE NULL
  END,
  CURRENT_TIMESTAMP
FROM "student_service_activations" activation;

INSERT INTO "audit_logs" (
  "operator_role",
  "object_type",
  "object_id",
  "action",
  "after_data",
  "reason",
  "request_id"
)
SELECT
  'SYSTEM',
  'student_service_activation',
  activation."id"::text,
  'S2_PROGRESS_MIGRATION_EXECUTED',
  jsonb_build_object(
    'studentId', activation."student_id",
    'completedStageCount', activation."completed_stage_count",
    'currentStageInstanceId', activation."current_stage_instance_id",
    'calculationStatus', activation."calculation_status",
    'calculationErrorCode', activation."calculation_error_code"
  ),
  CASE
    WHEN activation."calculation_status" = 'ERROR'
      THEN 'S1历史阶段结构异常，迁移保留任务事实并等待受控修复'
    ELSE 'S1历史任务按S2阻塞任务规则推导服务进度'
  END,
  'migration:20260803000100'
FROM "student_service_activations" activation;

INSERT INTO "stage_transitions" (
  "stage_instance_id",
  "from_status",
  "to_status",
  "trigger_type",
  "summary",
  "calculation_run_id",
  "deduplication_key",
  "created_at"
)
SELECT
  stage."id",
  CASE WHEN stage."sequence_no_snapshot" = 1 THEN NULL ELSE 'NOT_STARTED'::"StageStatus" END,
  'IN_PROGRESS',
  'MIGRATION',
  '历史数据迁移：阶段开始时间按既有任务事实推导',
  run."id",
  stage."id"::text || ':IN_PROGRESS:MIGRATION',
  stage."started_at"
FROM "stage_instances" stage
JOIN "service_progress_calculation_runs" run
  ON run."service_activation_id" = stage."service_activation_id"
  AND run."request_id" = 'migration:20260803000100'
WHERE stage."status" IN ('IN_PROGRESS', 'COMPLETED');

INSERT INTO "stage_transitions" (
  "stage_instance_id",
  "from_status",
  "to_status",
  "trigger_type",
  "summary",
  "calculation_run_id",
  "deduplication_key",
  "created_at"
)
SELECT
  stage."id",
  'IN_PROGRESS',
  'COMPLETED',
  'MIGRATION',
  '历史数据迁移：阻塞任务已全部进入终态',
  run."id",
  stage."id"::text || ':COMPLETED:MIGRATION',
  stage."completed_at"
FROM "stage_instances" stage
JOIN "service_progress_calculation_runs" run
  ON run."service_activation_id" = stage."service_activation_id"
  AND run."request_id" = 'migration:20260803000100'
WHERE stage."status" = 'COMPLETED'
  AND stage."service_activation_id" IN (
    SELECT activation."id"
    FROM "student_service_activations" activation
    WHERE activation."calculation_status" = 'NORMAL'
  );

ALTER TABLE "student_service_activations"
  ADD CONSTRAINT "student_service_activations_completed_stage_count_check"
    CHECK ("completed_stage_count" BETWEEN 0 AND 8);

ALTER TABLE "stage_instances"
  ADD CONSTRAINT "stage_instances_state_time_check" CHECK (
    ("status" = 'NOT_STARTED' AND "started_at" IS NULL AND "completed_at" IS NULL)
    OR ("status" = 'IN_PROGRESS' AND "started_at" IS NOT NULL AND "completed_at" IS NULL)
    OR ("status" = 'COMPLETED' AND "started_at" IS NOT NULL AND "completed_at" IS NOT NULL)
  );

ALTER TABLE "task_instances"
  ADD CONSTRAINT "task_instances_source_snapshot_check" CHECK (
    ("source_type" = 'SOP' AND "task_template_id" IS NOT NULL AND "completion_window_hours_snapshot" IS NOT NULL)
    OR ("source_type" = 'MANUAL' AND "task_template_id" IS NULL AND "completion_window_hours_snapshot" IS NULL)
  );

ALTER TABLE "stage_transitions"
  ADD CONSTRAINT "stage_transitions_target_status_check" CHECK (
    "to_status" IN ('IN_PROGRESS', 'COMPLETED')
  );

CREATE UNIQUE INDEX "student_service_activations_current_stage_instance_id_key"
  ON "student_service_activations"("current_stage_instance_id");
CREATE UNIQUE INDEX "stage_instances_one_in_progress_per_activation_idx"
  ON "stage_instances"("service_activation_id") WHERE "status" = 'IN_PROGRESS';
CREATE INDEX "stage_instances_service_activation_id_status_sequence_no_snapshot_idx"
  ON "stage_instances"("service_activation_id", "status", "sequence_no_snapshot");
CREATE INDEX "task_instances_stage_instance_id_is_blocking_snapshot_status_idx"
  ON "task_instances"("stage_instance_id", "is_blocking_snapshot", "status");
CREATE INDEX "task_instances_source_type_status_idx"
  ON "task_instances"("source_type", "status");
CREATE UNIQUE INDEX "stage_transitions_deduplication_key_key"
  ON "stage_transitions"("deduplication_key");
CREATE INDEX "stage_transitions_stage_instance_id_created_at_idx"
  ON "stage_transitions"("stage_instance_id", "created_at");
CREATE INDEX "stage_transitions_calculation_run_id_idx"
  ON "stage_transitions"("calculation_run_id");
CREATE UNIQUE INDEX "service_progress_run_request_key"
  ON "service_progress_calculation_runs"("service_activation_id", "type", "request_id");
CREATE UNIQUE INDEX "service_progress_run_idempotency_key"
  ON "service_progress_calculation_runs"("service_activation_id", "type", "idempotency_key");
CREATE INDEX "service_progress_calculation_runs_service_activation_id_started_at_idx"
  ON "service_progress_calculation_runs"("service_activation_id", "started_at");
CREATE INDEX "service_progress_calculation_runs_status_started_at_idx"
  ON "service_progress_calculation_runs"("status", "started_at");

ALTER TABLE "student_service_activations"
  ADD CONSTRAINT "student_service_activations_current_stage_instance_id_fkey"
  FOREIGN KEY ("current_stage_instance_id") REFERENCES "stage_instances"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_instances"
  ADD CONSTRAINT "task_instances_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "service_progress_calculation_runs"
  ADD CONSTRAINT "service_progress_calculation_runs_service_activation_id_fkey"
  FOREIGN KEY ("service_activation_id") REFERENCES "student_service_activations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_progress_calculation_runs"
  ADD CONSTRAINT "service_progress_calculation_runs_initiated_by_fkey"
  FOREIGN KEY ("initiated_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stage_transitions"
  ADD CONSTRAINT "stage_transitions_stage_instance_id_fkey"
  FOREIGN KEY ("stage_instance_id") REFERENCES "stage_instances"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_transitions"
  ADD CONSTRAINT "stage_transitions_trigger_task_id_fkey"
  FOREIGN KEY ("trigger_task_id") REFERENCES "task_instances"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stage_transitions"
  ADD CONSTRAINT "stage_transitions_calculation_run_id_fkey"
  FOREIGN KEY ("calculation_run_id") REFERENCES "service_progress_calculation_runs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
