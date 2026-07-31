-- S1 task supervision closure: versioned SOP, service activation snapshots,
-- task execution history, administrator interventions and overdue alerts.

CREATE TYPE "SopVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "OverdueAlertStatus" AS ENUM ('OPEN', 'HANDLED', 'RESOLVED');
CREATE TYPE "TaskTimelineEventType" AS ENUM (
  'CREATED',
  'ASSIGNED',
  'STARTED',
  'PROGRESS_UPDATED',
  'EXTENSION_REPORTED',
  'RESCHEDULED',
  'REASSIGNED',
  'COMPLETED',
  'CANCELED',
  'OVERDUE_ALERT_GENERATED',
  'OVERDUE_ALERT_HANDLED',
  'OVERDUE_ALERT_RESOLVED'
);

ALTER TABLE "students" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE "sop_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_no" INTEGER NOT NULL,
  "status" "SopVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "source_version_id" UUID,
  "published_at" TIMESTAMP(3),
  "created_by" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sop_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sop_stage_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sop_version_id" UUID NOT NULL,
  "stage_code" VARCHAR(32) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "description" VARCHAR(1000),
  CONSTRAINT "sop_stage_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sop_stage_templates_sequence_check" CHECK ("sequence_no" BETWEEN 1 AND 8)
);

CREATE TABLE "sop_task_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stage_template_id" UUID NOT NULL,
  "name" VARCHAR(150) NOT NULL,
  "sequence_no" INTEGER NOT NULL,
  "description" VARCHAR(2000),
  "completion_criteria" VARCHAR(2000),
  "completion_window_hours" INTEGER NOT NULL,
  "owner_role" VARCHAR(32) NOT NULL DEFAULT 'BUTLER',
  CONSTRAINT "sop_task_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sop_task_templates_sequence_check" CHECK ("sequence_no" >= 1),
  CONSTRAINT "sop_task_templates_window_check" CHECK ("completion_window_hours" >= 1),
  CONSTRAINT "sop_task_templates_owner_check" CHECK ("owner_role" = 'BUTLER')
);

CREATE TABLE "student_service_activations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "sop_version_id" UUID NOT NULL,
  "enabled_by" UUID NOT NULL,
  "enabled_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_service_activations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stage_instances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "service_activation_id" UUID NOT NULL,
  "sop_version_id" UUID NOT NULL,
  "stage_template_id" UUID NOT NULL,
  "stage_code_snapshot" VARCHAR(32) NOT NULL,
  "name_snapshot" VARCHAR(100) NOT NULL,
  "sequence_no_snapshot" INTEGER NOT NULL,
  "description_snapshot" VARCHAR(1000),
  CONSTRAINT "stage_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stage_instances_sequence_check" CHECK ("sequence_no_snapshot" BETWEEN 1 AND 8)
);

CREATE TABLE "task_instances" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "service_activation_id" UUID NOT NULL,
  "stage_instance_id" UUID NOT NULL,
  "task_template_id" UUID NOT NULL,
  "sop_version_id" UUID NOT NULL,
  "title_snapshot" VARCHAR(150) NOT NULL,
  "description_snapshot" VARCHAR(2000),
  "completion_criteria_snapshot" VARCHAR(2000),
  "completion_window_hours_snapshot" INTEGER NOT NULL,
  "owner_id" UUID,
  "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
  "progress_percent" INTEGER,
  "original_due_at" TIMESTAMP(3) NOT NULL,
  "current_due_at" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "completion_note" VARCHAR(2000),
  "canceled_at" TIMESTAMP(3),
  "canceled_by" UUID,
  "cancel_reason" VARCHAR(500),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_instances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_instances_window_check" CHECK ("completion_window_hours_snapshot" >= 1),
  CONSTRAINT "task_instances_progress_check" CHECK ("progress_percent" IS NULL OR "progress_percent" BETWEEN 0 AND 100)
);

CREATE TABLE "task_progress_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "progress_note" VARCHAR(2000) NOT NULL,
  "progress_percent" INTEGER,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_progress_records_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_progress_records_percent_check" CHECK ("progress_percent" IS NULL OR "progress_percent" BETWEEN 0 AND 99)
);

CREATE TABLE "task_extension_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "extension_reason" VARCHAR(500) NOT NULL,
  "expected_finish_at" TIMESTAMP(3) NOT NULL,
  "reported_by" UUID NOT NULL,
  "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_extension_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_due_date_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "old_due_at" TIMESTAMP(3) NOT NULL,
  "new_due_at" TIMESTAMP(3) NOT NULL,
  "change_reason" VARCHAR(500) NOT NULL,
  "operator_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_due_date_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_reassignments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "old_owner_id" UUID,
  "new_owner_id" UUID NOT NULL,
  "reassign_reason" VARCHAR(500) NOT NULL,
  "operator_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_reassignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "overdue_alerts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "overdue_episode_no" INTEGER NOT NULL,
  "status" "OverdueAlertStatus" NOT NULL DEFAULT 'OPEN',
  "first_overdue_at" TIMESTAMP(3) NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "handled_by" UUID,
  "handled_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "resolved_reason" VARCHAR(64),
  CONSTRAINT "overdue_alerts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overdue_alerts_episode_check" CHECK ("overdue_episode_no" >= 1)
);

CREATE TABLE "task_timeline_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "event_type" "TaskTimelineEventType" NOT NULL,
  "actor_id" UUID,
  "actor_role" VARCHAR(32),
  "summary" VARCHAR(500) NOT NULL,
  "reason" VARCHAR(500),
  "before_data" JSONB,
  "after_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_operation_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "task_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "operation" VARCHAR(64) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "response_data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_operation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sop_versions_version_no_key" ON "sop_versions"("version_no");
CREATE UNIQUE INDEX "sop_versions_only_one_published_idx" ON "sop_versions"("status") WHERE "status" = 'PUBLISHED';
CREATE INDEX "sop_versions_status_created_at_idx" ON "sop_versions"("status", "created_at");
CREATE UNIQUE INDEX "sop_stage_templates_sop_version_id_stage_code_key" ON "sop_stage_templates"("sop_version_id", "stage_code");
CREATE UNIQUE INDEX "sop_stage_templates_sop_version_id_sequence_no_key" ON "sop_stage_templates"("sop_version_id", "sequence_no");
CREATE UNIQUE INDEX "sop_task_templates_stage_template_id_sequence_no_key" ON "sop_task_templates"("stage_template_id", "sequence_no");
CREATE UNIQUE INDEX "student_service_activations_student_id_key" ON "student_service_activations"("student_id");
CREATE INDEX "student_service_activations_sop_version_id_idx" ON "student_service_activations"("sop_version_id");
CREATE INDEX "stage_instances_student_id_sequence_no_snapshot_idx" ON "stage_instances"("student_id", "sequence_no_snapshot");
CREATE UNIQUE INDEX "stage_instances_service_activation_id_stage_template_id_key" ON "stage_instances"("service_activation_id", "stage_template_id");
CREATE UNIQUE INDEX "stage_instances_service_activation_id_sequence_no_snapshot_key" ON "stage_instances"("service_activation_id", "sequence_no_snapshot");
CREATE INDEX "task_instances_owner_id_status_current_due_at_idx" ON "task_instances"("owner_id", "status", "current_due_at");
CREATE INDEX "task_instances_student_id_status_idx" ON "task_instances"("student_id", "status");
CREATE INDEX "task_instances_stage_instance_id_idx" ON "task_instances"("stage_instance_id");
CREATE INDEX "task_instances_status_current_due_at_idx" ON "task_instances"("status", "current_due_at");
CREATE UNIQUE INDEX "task_instances_service_activation_id_task_template_id_key" ON "task_instances"("service_activation_id", "task_template_id");
CREATE INDEX "task_progress_records_task_id_created_at_idx" ON "task_progress_records"("task_id", "created_at");
CREATE INDEX "task_extension_reports_task_id_reported_at_idx" ON "task_extension_reports"("task_id", "reported_at");
CREATE INDEX "task_due_date_changes_task_id_created_at_idx" ON "task_due_date_changes"("task_id", "created_at");
CREATE INDEX "task_reassignments_task_id_created_at_idx" ON "task_reassignments"("task_id", "created_at");
CREATE INDEX "overdue_alerts_status_generated_at_idx" ON "overdue_alerts"("status", "generated_at");
CREATE UNIQUE INDEX "overdue_alerts_task_id_overdue_episode_no_key" ON "overdue_alerts"("task_id", "overdue_episode_no");
CREATE INDEX "task_timeline_events_task_id_created_at_idx" ON "task_timeline_events"("task_id", "created_at");
CREATE INDEX "task_operation_receipts_task_id_created_at_idx" ON "task_operation_receipts"("task_id", "created_at");
CREATE UNIQUE INDEX "task_operation_receipts_actor_id_operation_idempotency_key_key" ON "task_operation_receipts"("actor_id", "operation", "idempotency_key");

ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "sop_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sop_versions" ADD CONSTRAINT "sop_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sop_stage_templates" ADD CONSTRAINT "sop_stage_templates_sop_version_id_fkey" FOREIGN KEY ("sop_version_id") REFERENCES "sop_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sop_task_templates" ADD CONSTRAINT "sop_task_templates_stage_template_id_fkey" FOREIGN KEY ("stage_template_id") REFERENCES "sop_stage_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_service_activations" ADD CONSTRAINT "student_service_activations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_service_activations" ADD CONSTRAINT "student_service_activations_sop_version_id_fkey" FOREIGN KEY ("sop_version_id") REFERENCES "sop_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_service_activations" ADD CONSTRAINT "student_service_activations_enabled_by_fkey" FOREIGN KEY ("enabled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_instances" ADD CONSTRAINT "stage_instances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_instances" ADD CONSTRAINT "stage_instances_service_activation_id_fkey" FOREIGN KEY ("service_activation_id") REFERENCES "student_service_activations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_instances" ADD CONSTRAINT "stage_instances_sop_version_id_fkey" FOREIGN KEY ("sop_version_id") REFERENCES "sop_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stage_instances" ADD CONSTRAINT "stage_instances_stage_template_id_fkey" FOREIGN KEY ("stage_template_id") REFERENCES "sop_stage_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_service_activation_id_fkey" FOREIGN KEY ("service_activation_id") REFERENCES "student_service_activations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_stage_instance_id_fkey" FOREIGN KEY ("stage_instance_id") REFERENCES "stage_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_task_template_id_fkey" FOREIGN KEY ("task_template_id") REFERENCES "sop_task_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_sop_version_id_fkey" FOREIGN KEY ("sop_version_id") REFERENCES "sop_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_instances" ADD CONSTRAINT "task_instances_canceled_by_fkey" FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_progress_records" ADD CONSTRAINT "task_progress_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_progress_records" ADD CONSTRAINT "task_progress_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_extension_reports" ADD CONSTRAINT "task_extension_reports_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_extension_reports" ADD CONSTRAINT "task_extension_reports_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_due_date_changes" ADD CONSTRAINT "task_due_date_changes_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_due_date_changes" ADD CONSTRAINT "task_due_date_changes_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_reassignments" ADD CONSTRAINT "task_reassignments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_reassignments" ADD CONSTRAINT "task_reassignments_old_owner_id_fkey" FOREIGN KEY ("old_owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_reassignments" ADD CONSTRAINT "task_reassignments_new_owner_id_fkey" FOREIGN KEY ("new_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_reassignments" ADD CONSTRAINT "task_reassignments_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overdue_alerts" ADD CONSTRAINT "overdue_alerts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "overdue_alerts" ADD CONSTRAINT "overdue_alerts_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_timeline_events" ADD CONSTRAINT "task_timeline_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_timeline_events" ADD CONSTRAINT "task_timeline_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_operation_receipts" ADD CONSTRAINT "task_operation_receipts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_operation_receipts" ADD CONSTRAINT "task_operation_receipts_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
