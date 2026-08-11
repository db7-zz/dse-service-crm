ALTER TYPE "ApplicationStatus" ADD VALUE 'SUBMISSION_PENDING_EVIDENCE' AFTER 'PENDING_SUBMISSION';
ALTER TYPE "ApplicationStatus" ADD VALUE 'WAITLISTED' AFTER 'INTERVIEW';

CREATE TYPE "ApplicationDeadlineMode" AS ENUM ('FIXED', 'ROLLING', 'UNKNOWN');
CREATE TYPE "ApplicationActivityType" AS ENUM (
  'CREATED',
  'MATERIALS_UPDATED',
  'SUBMISSION_RECORDED',
  'SUPPLEMENT_RECORDED',
  'NOTIFICATION_RECEIVED',
  'RESULT_RECORDED',
  'CORRECTION',
  'EVIDENCE_RETURNED',
  'OWNER_TRANSFERRED',
  'OTHER'
);

ALTER TABLE "applications"
  ADD COLUMN "program_choices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deadline_mode" "ApplicationDeadlineMode" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "request_basis" VARCHAR(1000),
  ADD COLUMN "portal_url" VARCHAR(1000);

UPDATE "applications"
SET "deadline_mode" = CASE
  WHEN "deadline_at" IS NOT NULL THEN 'FIXED'::"ApplicationDeadlineMode"
  ELSE 'UNKNOWN'::"ApplicationDeadlineMode"
END;

CREATE TABLE "application_activities" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "activity_type" "ApplicationActivityType" NOT NULL,
  "note" VARCHAR(2000) NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "operator_id" UUID NOT NULL,
  "student_visible" BOOLEAN NOT NULL DEFAULT false,
  "portal_url" VARCHAR(1000),
  "application_no_snapshot" VARCHAR(100),
  "target_status" "ApplicationStatus",
  "result_snapshot" VARCHAR(500),
  "correction_of_activity_id" UUID,
  "invalidated_at" TIMESTAMP(3),
  "invalidated_by" UUID,
  "invalid_reason" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "activity_id" UUID NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "file_hash" CHAR(64) NOT NULL,
  "uploaded_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "application_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_material_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "application_id" UUID NOT NULL,
  "material_item_id" UUID NOT NULL,
  "material_version_id" UUID NOT NULL,
  "selected_by" UUID NOT NULL,
  "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "frozen_at" TIMESTAMP(3),
  CONSTRAINT "application_material_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "application_evidence_storage_key_key" ON "application_evidence"("storage_key");
CREATE INDEX "application_evidence_activity_id_created_at_idx" ON "application_evidence"("activity_id", "created_at");
CREATE INDEX "application_activities_application_id_occurred_at_idx" ON "application_activities"("application_id", "occurred_at");
CREATE INDEX "application_activities_application_id_activity_type_created_at_idx" ON "application_activities"("application_id", "activity_type", "created_at");
CREATE INDEX "application_activities_correction_of_activity_id_idx" ON "application_activities"("correction_of_activity_id");
CREATE UNIQUE INDEX "application_material_snapshots_application_id_material_item_id_key" ON "application_material_snapshots"("application_id", "material_item_id");
CREATE INDEX "application_material_snapshots_application_id_frozen_at_idx" ON "application_material_snapshots"("application_id", "frozen_at");
CREATE INDEX "application_material_snapshots_material_version_id_idx" ON "application_material_snapshots"("material_version_id");

ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_correction_of_activity_id_fkey" FOREIGN KEY ("correction_of_activity_id") REFERENCES "application_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_activities" ADD CONSTRAINT "application_activities_invalidated_by_fkey" FOREIGN KEY ("invalidated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "application_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_material_snapshots" ADD CONSTRAINT "application_material_snapshots_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_material_snapshots" ADD CONSTRAINT "application_material_snapshots_material_item_id_fkey" FOREIGN KEY ("material_item_id") REFERENCES "material_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_material_snapshots" ADD CONSTRAINT "application_material_snapshots_material_version_id_fkey" FOREIGN KEY ("material_version_id") REFERENCES "material_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "application_material_snapshots" ADD CONSTRAINT "application_material_snapshots_selected_by_fkey" FOREIGN KEY ("selected_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
