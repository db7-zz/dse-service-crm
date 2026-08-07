ALTER TYPE "MaterialStatus" ADD VALUE 'DRAFT';
ALTER TYPE "MaterialStatus" ADD VALUE 'IN_REVIEW';
ALTER TYPE "MaterialStatus" ADD VALUE 'NEEDS_CORRECTION';
ALTER TYPE "MaterialStatus" ADD VALUE 'CANCELED';

ALTER TYPE "NotificationEventType" ADD VALUE 'MATERIAL_SUBMITTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'MATERIAL_REVIEWED';
ALTER TYPE "NotificationEventType" ADD VALUE 'MATERIAL_CORRECTION_REQUIRED';
ALTER TYPE "NotificationEventType" ADD VALUE 'MATERIAL_APPLICABILITY_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE 'MATERIAL_APPLICABILITY_REVIEWED';

CREATE TYPE "MaterialRequirementKind" AS ENUM ('REQUIRED', 'CONDITIONAL', 'OPTIONAL');
CREATE TYPE "MaterialDeadlineRule" AS ENUM ('ACTIVATION_OFFSET', 'STAGE_OFFSET', 'FIXED_DATE');
CREATE TYPE "MaterialItemOrigin" AS ENUM ('SOP_TEMPLATE', 'SPECIAL');
CREATE TYPE "MaterialSubmissionStatus" AS ENUM (
  'DRAFT',
  'PENDING_REVIEW',
  'IN_REVIEW',
  'NEEDS_CORRECTION',
  'APPROVED',
  'WITHDRAWN'
);
CREATE TYPE "MaterialSubmissionSource" AS ENUM ('STUDENT', 'BUTLER', 'LEGACY');
CREATE TYPE "MaterialApplicabilityRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "sop_material_templates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "template_key" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stage_template_id" UUID NOT NULL,
  "material_type_id" UUID NOT NULL,
  "title" VARCHAR(150) NOT NULL,
  "requirement" VARCHAR(2000),
  "requirement_kind" "MaterialRequirementKind" NOT NULL DEFAULT 'REQUIRED',
  "deadline_rule" "MaterialDeadlineRule" NOT NULL DEFAULT 'ACTIVATION_OFFSET',
  "deadline_offset_days" INTEGER,
  "fixed_due_at" TIMESTAMP(3),
  "condition_rule" JSONB,
  "sequence_no" INTEGER NOT NULL,
  CONSTRAINT "sop_material_templates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sop_material_templates_deadline_rule_check" CHECK (
    ("deadline_rule" = 'FIXED_DATE' AND "fixed_due_at" IS NOT NULL AND "deadline_offset_days" IS NULL)
    OR
    ("deadline_rule" IN ('ACTIVATION_OFFSET', 'STAGE_OFFSET') AND "deadline_offset_days" IS NOT NULL AND "deadline_offset_days" >= 0 AND "fixed_due_at" IS NULL)
  ),
  CONSTRAINT "sop_material_templates_condition_check" CHECK (
    "requirement_kind" = 'CONDITIONAL' OR "condition_rule" IS NULL
  )
);

INSERT INTO "sop_material_templates" (
  "stage_template_id",
  "material_type_id",
  "title",
  "requirement",
  "requirement_kind",
  "deadline_rule",
  "deadline_offset_days",
  "sequence_no"
)
SELECT
  stage."id",
  material_type."id",
  material_type."name",
  material_type."description",
  CASE
    WHEN material_type."is_core" THEN 'REQUIRED'::"MaterialRequirementKind"
    ELSE 'OPTIONAL'::"MaterialRequirementKind"
  END,
  CASE
    WHEN material_type."collection_phase" = 'CURRENT' THEN 'ACTIVATION_OFFSET'::"MaterialDeadlineRule"
    ELSE 'STAGE_OFFSET'::"MaterialDeadlineRule"
  END,
  7,
  ROW_NUMBER() OVER (
    PARTITION BY stage."id"
    ORDER BY material_type."sequence_no", material_type."name", material_type."id"
  )::INTEGER
FROM "sop_stage_templates" stage
CROSS JOIN "material_types" material_type
WHERE stage."stage_code" = 'MATERIALS'
  AND material_type."is_active" = TRUE;

-- Existing drafts were cloned before material templates had a stable cross-version key.
-- Reuse the oldest source version's key for matching stage/type pairs so a later
-- additive backfill does not mistake unchanged templates for newly added ones.
WITH RECURSIVE "version_lineage" AS (
  SELECT
    version."id" AS "child_version_id",
    version."source_version_id" AS "ancestor_version_id",
    1 AS "depth"
  FROM "sop_versions" version
  WHERE version."source_version_id" IS NOT NULL

  UNION ALL

  SELECT
    lineage."child_version_id",
    ancestor."source_version_id" AS "ancestor_version_id",
    lineage."depth" + 1
  FROM "version_lineage" lineage
  JOIN "sop_versions" ancestor
    ON ancestor."id" = lineage."ancestor_version_id"
  WHERE ancestor."source_version_id" IS NOT NULL
),
"oldest_source" AS (
  SELECT DISTINCT ON (lineage."child_version_id")
    lineage."child_version_id",
    lineage."ancestor_version_id"
  FROM "version_lineage" lineage
  ORDER BY lineage."child_version_id", lineage."depth" DESC
)
UPDATE "sop_material_templates" target_template
SET "template_key" = source_template."template_key"
FROM "sop_stage_templates" target_stage
JOIN "oldest_source" source_version
  ON source_version."child_version_id" = target_stage."sop_version_id"
JOIN "sop_stage_templates" source_stage
  ON source_stage."sop_version_id" = source_version."ancestor_version_id"
  AND source_stage."stage_code" = target_stage."stage_code"
JOIN "sop_material_templates" source_template
  ON source_template."stage_template_id" = source_stage."id"
WHERE target_template."stage_template_id" = target_stage."id"
  AND target_template."material_type_id" = source_template."material_type_id";

CREATE UNIQUE INDEX "sop_material_templates_stage_template_id_sequence_no_key"
  ON "sop_material_templates"("stage_template_id", "sequence_no");
CREATE UNIQUE INDEX "sop_material_templates_stage_template_id_material_type_id_key"
  ON "sop_material_templates"("stage_template_id", "material_type_id");
CREATE INDEX "sop_material_templates_material_type_id_idx"
  ON "sop_material_templates"("material_type_id");
CREATE INDEX "sop_material_templates_template_key_idx"
  ON "sop_material_templates"("template_key");

ALTER TABLE "sop_material_templates"
  ADD CONSTRAINT "sop_material_templates_stage_template_id_fkey"
  FOREIGN KEY ("stage_template_id") REFERENCES "sop_stage_templates"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sop_material_templates"
  ADD CONSTRAINT "sop_material_templates_material_type_id_fkey"
  FOREIGN KEY ("material_type_id") REFERENCES "material_types"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "material_items_student_id_material_type_id_key";

ALTER TABLE "material_items"
  ALTER COLUMN "requirement" TYPE VARCHAR(2000),
  ADD COLUMN "sop_material_template_id" UUID,
  ADD COLUMN "template_key_snapshot" UUID,
  ADD COLUMN "origin" "MaterialItemOrigin" NOT NULL DEFAULT 'SOP_TEMPLATE',
  ADD COLUMN "requirement_kind" "MaterialRequirementKind" NOT NULL DEFAULT 'REQUIRED',
  ADD COLUMN "deadline_rule" "MaterialDeadlineRule",
  ADD COLUMN "deadline_offset_days" INTEGER,
  ADD COLUMN "fixed_due_at_snapshot" TIMESTAMP(3),
  ADD COLUMN "condition_rule_snapshot" JSONB,
  ADD COLUMN "condition_matched" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "created_by" UUID,
  ADD COLUMN "creation_reason" VARCHAR(1000),
  ADD COLUMN "current_submission_id" UUID,
  ADD COLUMN "correction_due_at" TIMESTAMP(3),
  ADD COLUMN "canceled_at" TIMESTAMP(3),
  ADD COLUMN "canceled_by" UUID,
  ADD COLUMN "cancel_reason" VARCHAR(1000);

UPDATE "material_items" material
SET
  "sop_material_template_id" = template."id",
  "template_key_snapshot" = template."template_key",
  "origin" = 'SOP_TEMPLATE',
  "requirement_kind" = template."requirement_kind",
  "deadline_rule" = template."deadline_rule",
  "deadline_offset_days" = template."deadline_offset_days",
  "fixed_due_at_snapshot" = template."fixed_due_at",
  "condition_rule_snapshot" = template."condition_rule",
  "created_by" = activation."enabled_by"
FROM "student_service_activations" activation
JOIN "sop_stage_templates" stage
  ON stage."sop_version_id" = activation."sop_version_id"
JOIN "sop_material_templates" template
  ON template."stage_template_id" = stage."id"
WHERE activation."student_id" = material."student_id"
  AND template."material_type_id" = material."material_type_id";

UPDATE "material_items" material
SET
  "origin" = 'SPECIAL',
  "requirement_kind" = CASE
    WHEN material_type."is_core" THEN 'REQUIRED'::"MaterialRequirementKind"
    ELSE 'OPTIONAL'::"MaterialRequirementKind"
  END,
  "created_by" = COALESCE(material."owner_id", student."created_by")
FROM "material_types" material_type, "students" student
WHERE material."sop_material_template_id" IS NULL
  AND material_type."id" = material."material_type_id"
  AND student."id" = material."student_id";

CREATE UNIQUE INDEX "material_items_current_submission_id_key"
  ON "material_items"("current_submission_id");
CREATE UNIQUE INDEX "material_items_student_id_sop_material_template_id_key"
  ON "material_items"("student_id", "sop_material_template_id");
CREATE UNIQUE INDEX "material_items_student_id_template_key_snapshot_key"
  ON "material_items"("student_id", "template_key_snapshot");
CREATE INDEX "material_items_material_type_id_origin_idx"
  ON "material_items"("material_type_id", "origin");

ALTER TABLE "material_items"
  ADD CONSTRAINT "material_items_sop_material_template_id_fkey"
  FOREIGN KEY ("sop_material_template_id") REFERENCES "sop_material_templates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_items"
  ADD CONSTRAINT "material_items_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_items"
  ADD CONSTRAINT "material_items_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_items"
  ADD CONSTRAINT "material_items_cancellation_check" CHECK (
    ("status" = 'CANCELED' AND "canceled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
    OR "status" <> 'CANCELED'
  ) NOT VALID;

CREATE TABLE "material_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "material_item_id" UUID NOT NULL,
  "submission_no" INTEGER NOT NULL,
  "status" "MaterialSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "source" "MaterialSubmissionSource" NOT NULL,
  "created_by" UUID NOT NULL,
  "submitted_by" UUID,
  "submission_reason" VARCHAR(1000),
  "submitted_at" TIMESTAMP(3),
  "withdrawn_at" TIMESTAMP(3),
  "withdrawal_reason" VARCHAR(1000),
  "review_started_by" UUID,
  "review_started_at" TIMESTAMP(3),
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_comment" VARCHAR(1000),
  "correction_due_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_submissions_butler_reason_check" CHECK (
    "source" <> 'BUTLER' OR NULLIF(BTRIM("submission_reason"), '') IS NOT NULL
  ),
  CONSTRAINT "material_submissions_state_time_check" CHECK (
    ("status" = 'DRAFT' AND "submitted_at" IS NULL)
    OR ("status" IN ('PENDING_REVIEW', 'IN_REVIEW', 'NEEDS_CORRECTION', 'APPROVED') AND "submitted_at" IS NOT NULL)
    OR ("status" = 'WITHDRAWN' AND "submitted_at" IS NOT NULL AND "withdrawn_at" IS NOT NULL)
  )
);

CREATE TABLE "material_submission_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "submission_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "review_status" "MaterialReviewStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_comment" VARCHAR(1000),
  "copied_from_file_id" UUID,
  "removed_at" TIMESTAMP(3),
  "removed_by" UUID,
  "removal_reason" VARCHAR(500),
  CONSTRAINT "material_submission_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "material_submission_files_size_check" CHECK ("file_size" > 0),
  CONSTRAINT "material_submission_files_removal_check" CHECK (
    "removed_at" IS NULL OR "removed_by" IS NOT NULL
  )
);

INSERT INTO "material_submissions" (
  "id",
  "material_item_id",
  "submission_no",
  "status",
  "source",
  "created_by",
  "submitted_by",
  "submitted_at",
  "reviewed_by",
  "reviewed_at",
  "review_comment",
  "correction_due_at",
  "created_at",
  "updated_at"
)
SELECT
  version."id",
  version."material_item_id",
  version."version_no",
  CASE version."review_status"
    WHEN 'APPROVED' THEN 'APPROVED'::"MaterialSubmissionStatus"
    WHEN 'REJECTED' THEN 'NEEDS_CORRECTION'::"MaterialSubmissionStatus"
    ELSE 'PENDING_REVIEW'::"MaterialSubmissionStatus"
  END,
  'LEGACY'::"MaterialSubmissionSource",
  version."uploaded_by",
  version."uploaded_by",
  version."uploaded_at",
  version."reviewed_by",
  version."reviewed_at",
  version."review_comment",
  CASE WHEN version."review_status" = 'REJECTED' THEN material."expected_submit_at" ELSE NULL END,
  version."uploaded_at",
  COALESCE(version."reviewed_at", version."uploaded_at")
FROM "material_versions" version
JOIN "material_items" material ON material."id" = version."material_item_id";

INSERT INTO "material_submission_files" (
  "submission_id",
  "file_name",
  "mime_type",
  "file_size",
  "storage_key",
  "file_hash",
  "uploaded_by",
  "uploaded_at",
  "review_status",
  "reviewed_by",
  "reviewed_at",
  "review_comment"
)
SELECT
  version."id",
  version."file_name",
  version."mime_type",
  version."file_size",
  version."storage_key",
  version."file_hash",
  version."uploaded_by",
  version."uploaded_at",
  version."review_status",
  version."reviewed_by",
  version."reviewed_at",
  version."review_comment"
FROM "material_versions" version;

UPDATE "material_items"
SET "current_submission_id" = "current_version_id"
WHERE "current_version_id" IS NOT NULL;

CREATE UNIQUE INDEX "material_submissions_material_item_id_submission_no_key"
  ON "material_submissions"("material_item_id", "submission_no");
CREATE INDEX "material_submissions_material_item_id_status_created_at_idx"
  ON "material_submissions"("material_item_id", "status", "created_at");
CREATE INDEX "material_submissions_status_submitted_at_idx"
  ON "material_submissions"("status", "submitted_at");
CREATE UNIQUE INDEX "material_submissions_one_draft_per_item_idx"
  ON "material_submissions"("material_item_id")
  WHERE "status" = 'DRAFT';
CREATE INDEX "material_submission_files_submission_id_removed_at_uploaded_at_idx"
  ON "material_submission_files"("submission_id", "removed_at", "uploaded_at");
CREATE INDEX "material_submission_files_storage_key_idx"
  ON "material_submission_files"("storage_key");
CREATE INDEX "material_submission_files_review_status_uploaded_at_idx"
  ON "material_submission_files"("review_status", "uploaded_at");

ALTER TABLE "material_submissions"
  ADD CONSTRAINT "material_submissions_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_submissions"
  ADD CONSTRAINT "material_submissions_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_submissions"
  ADD CONSTRAINT "material_submissions_submitted_by_fkey"
  FOREIGN KEY ("submitted_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_submissions"
  ADD CONSTRAINT "material_submissions_review_started_by_fkey"
  FOREIGN KEY ("review_started_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_submissions"
  ADD CONSTRAINT "material_submissions_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_submission_files"
  ADD CONSTRAINT "material_submission_files_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "material_submissions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_submission_files"
  ADD CONSTRAINT "material_submission_files_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_submission_files"
  ADD CONSTRAINT "material_submission_files_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_submission_files"
  ADD CONSTRAINT "material_submission_files_copied_from_file_id_fkey"
  FOREIGN KEY ("copied_from_file_id") REFERENCES "material_submission_files"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_submission_files"
  ADD CONSTRAINT "material_submission_files_removed_by_fkey"
  FOREIGN KEY ("removed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "material_items"
  ADD CONSTRAINT "material_items_current_submission_id_fkey"
  FOREIGN KEY ("current_submission_id") REFERENCES "material_submissions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "material_applicability_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "material_item_id" UUID NOT NULL,
  "requested_by" UUID NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "status" "MaterialApplicabilityRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "review_comment" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_applicability_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "material_applicability_requests_material_item_id_status_created_at_idx"
  ON "material_applicability_requests"("material_item_id", "status", "created_at");
CREATE INDEX "material_applicability_requests_status_created_at_idx"
  ON "material_applicability_requests"("status", "created_at");
CREATE UNIQUE INDEX "material_applicability_requests_one_pending_per_item_idx"
  ON "material_applicability_requests"("material_item_id")
  WHERE "status" = 'PENDING';

ALTER TABLE "material_applicability_requests"
  ADD CONSTRAINT "material_applicability_requests_material_item_id_fkey"
  FOREIGN KEY ("material_item_id") REFERENCES "material_items"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_applicability_requests"
  ADD CONSTRAINT "material_applicability_requests_requested_by_fkey"
  FOREIGN KEY ("requested_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_applicability_requests"
  ADD CONSTRAINT "material_applicability_requests_reviewed_by_fkey"
  FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DELETE FROM "role_permissions" role_permission
USING "roles" role, "permissions" permission
WHERE role_permission."role_id" = role."id"
  AND role_permission."permission_id" = permission."id"
  AND role."role_code" = 'ADMINISTRATOR'
  AND permission."permission_code" = 'materials.write';
