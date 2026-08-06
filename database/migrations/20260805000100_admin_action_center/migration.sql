-- CreateEnum
CREATE TYPE "RectificationStatus" AS ENUM (
  'PENDING_RECTIFICATION',
  'PENDING_REVIEW',
  'CLOSED'
);

-- AlterTable
ALTER TABLE "users"
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "temporary_password_expires_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "issues"
ADD COLUMN "owner_id" UUID,
ADD COLUMN "due_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "rectification_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "butler_id" UUID NOT NULL,
  "created_by" UUID NOT NULL,
  "summary" VARCHAR(2000) NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" "RectificationStatus" NOT NULL DEFAULT 'PENDING_RECTIFICATION',
  "response_note" VARCHAR(4000),
  "submitted_at" TIMESTAMP(3),
  "review_note" VARCHAR(4000),
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMP(3),
  "closed_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rectification_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rectification_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "rectification_id" UUID NOT NULL,
  "task_id" UUID,
  "issue_id" UUID,
  "title_snapshot" VARCHAR(200) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rectification_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rectification_items_target_check" CHECK (
    (("task_id" IS NOT NULL)::int + ("issue_id" IS NOT NULL)::int) = 1
  )
);

-- CreateIndex
CREATE INDEX "issues_owner_id_status_due_at_idx" ON "issues"("owner_id", "status", "due_at");
CREATE INDEX "rectification_records_butler_id_status_due_at_idx" ON "rectification_records"("butler_id", "status", "due_at");
CREATE INDEX "rectification_records_status_updated_at_idx" ON "rectification_records"("status", "updated_at");
CREATE UNIQUE INDEX "rectification_items_rectification_id_task_id_key" ON "rectification_items"("rectification_id", "task_id");
CREATE UNIQUE INDEX "rectification_items_rectification_id_issue_id_key" ON "rectification_items"("rectification_id", "issue_id");
CREATE INDEX "rectification_items_task_id_idx" ON "rectification_items"("task_id");
CREATE INDEX "rectification_items_issue_id_idx" ON "rectification_items"("issue_id");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rectification_records" ADD CONSTRAINT "rectification_records_butler_id_fkey" FOREIGN KEY ("butler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rectification_records" ADD CONSTRAINT "rectification_records_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rectification_records" ADD CONSTRAINT "rectification_records_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rectification_items" ADD CONSTRAINT "rectification_items_rectification_id_fkey" FOREIGN KEY ("rectification_id") REFERENCES "rectification_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rectification_items" ADD CONSTRAINT "rectification_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rectification_items" ADD CONSTRAINT "rectification_items_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- New and updated rows must not enter enabled service without the complete onboarding aggregate.
-- The constraint is NOT VALID so legacy orphan records can be repaired through the new workflow.
ALTER TABLE "students" ADD CONSTRAINT "students_enabled_onboarding_complete_check"
CHECK (
  "service_status" <> 'ENABLED'
  OR (
    "portal_user_id" IS NOT NULL
    AND "default_butler_id" IS NOT NULL
    AND "planner_id" IS NOT NULL
  )
) NOT VALID;
