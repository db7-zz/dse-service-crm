-- CreateEnum
CREATE TYPE "StudentRiskLevel" AS ENUM ('NORMAL', 'ATTENTION', 'HIGH');

-- CreateEnum
CREATE TYPE "ScoreType" AS ENUM ('CURRENT', 'PREDICTED');

-- CreateEnum
CREATE TYPE "TargetLevel" AS ENUM ('ASPIRATIONAL', 'MATCH', 'SAFE', 'OTHER');

-- CreateEnum
CREATE TYPE "MaterialStatus" AS ENUM ('REQUIRED', 'PENDING_REVIEW', 'APPROVED', 'PARTIALLY_MISSING', 'RESUBMISSION_REQUIRED', 'AWAITING_CONFIRMATION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MaterialReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaterialArchiveStatus" AS ENUM ('NOT_ARCHIVED', 'ARCHIVED', 'ARCHIVE_FAILED');

-- CreateEnum
CREATE TYPE "ApplicationChannel" AS ENUM ('HK_DIRECT', 'JUPAS');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PLANNING', 'CONFIRMED', 'MATERIAL_PREPARATION', 'PENDING_SUBMISSION', 'SUBMITTED', 'WAITING_RESULT', 'SUPPLEMENT', 'INTERVIEW', 'OFFER', 'REJECTED', 'ENROLLED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationRequirementStatus" AS ENUM ('OPEN', 'COMPLETED', 'WAIVED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'NEEDS_INFO', 'RESPONDED', 'CONVERTED_TO_TASK', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IssueLogAction" AS ENUM ('CREATED', 'INFORMATION_ADDED', 'INFORMATION_REQUESTED', 'RESPONDED', 'CONVERTED_TO_TASK', 'RESOLVED', 'CLOSED', 'REOPENED');

-- CreateEnum
CREATE TYPE "NotificationEventType" AS ENUM ('TASK_ASSIGNED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'TASK_EXTENSION_REPORTED', 'TASK_REASSIGNED', 'MATERIAL_UPLOADED', 'MATERIAL_MISSING', 'STAGE_CHANGED', 'APPLICATION_STATUS_CHANGED', 'ISSUE_SUBMITTED', 'SPECIALIST_TASK_ASSIGNED', 'STUDENT_RESPONSIBILITY_CHANGED');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StudentServiceStatus" ADD VALUE 'PAUSED';
ALTER TYPE "StudentServiceStatus" ADD VALUE 'TERMINATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskSourceType" ADD VALUE 'MATERIAL';
ALTER TYPE "TaskSourceType" ADD VALUE 'APPLICATION';
ALTER TYPE "TaskSourceType" ADD VALUE 'ISSUE';

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'NOT_APPLICABLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskTimelineEventType" ADD VALUE 'MARKED_NOT_APPLICABLE';
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'REOPENED';
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'EVIDENCE_ADDED';

-- AlterEnum
ALTER TYPE "StageTransitionTriggerType" ADD VALUE 'TASK_NOT_APPLICABLE';

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "cohort_year" INTEGER,
ADD COLUMN     "english_name" VARCHAR(100),
ADD COLUMN     "grade" VARCHAR(32),
ADD COLUMN     "next_milestone" VARCHAR(500),
ADD COLUMN     "portal_user_id" UUID,
ADD COLUMN     "risk_level" "StudentRiskLevel" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "risk_note" VARCHAR(1000),
ADD COLUMN     "school" VARCHAR(150);

-- AlterTable
ALTER TABLE "task_instances" ADD COLUMN     "evidence_required_snapshot" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "external_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source_object_id" UUID;

-- CreateTable
CREATE TABLE "student_scores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "subject_name" VARCHAR(100) NOT NULL,
    "score_type" "ScoreType" NOT NULL,
    "score_value" VARCHAR(100) NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_targets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "institution_name" VARCHAR(200) NOT NULL,
    "program_name" VARCHAR(200),
    "target_level" "TargetLevel" NOT NULL DEFAULT 'OTHER',
    "status" VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_types" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_core" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "material_type_id" UUID NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "requirement" VARCHAR(1000),
    "due_at" TIMESTAMP(3),
    "owner_id" UUID,
    "status" "MaterialStatus" NOT NULL DEFAULT 'REQUIRED',
    "missing_reason" VARCHAR(1000),
    "expected_submit_at" TIMESTAMP(3),
    "current_version_id" UUID,
    "archive_status" "MaterialArchiveStatus" NOT NULL DEFAULT 'NOT_ARCHIVED',
    "archived_at" TIMESTAMP(3),
    "archive_note" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_item_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
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

    CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_followups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "material_item_id" UUID NOT NULL,
    "task_id" UUID,
    "followup_note" VARCHAR(1000) NOT NULL,
    "followed_by" UUID NOT NULL,
    "followed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_followups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "channel" "ApplicationChannel" NOT NULL,
    "institution_name" VARCHAR(200) NOT NULL,
    "program_name" VARCHAR(200),
    "preference_no" INTEGER,
    "round_name" VARCHAR(100),
    "deadline_at" TIMESTAMP(3),
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PLANNING',
    "submitted_at" TIMESTAMP(3),
    "application_no" VARCHAR(100),
    "result" VARCHAR(500),
    "offer_condition" VARCHAR(1000),
    "confirmation_deadline" TIMESTAMP(3),
    "owner_id" UUID,
    "intake_decision" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_status_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "from_status" "ApplicationStatus",
    "to_status" "ApplicationStatus" NOT NULL,
    "note" VARCHAR(1000),
    "before_data" JSONB,
    "after_data" JSONB,
    "operator_id" UUID NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_requirements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "application_id" UUID NOT NULL,
    "requirement_type" VARCHAR(64) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "due_at" TIMESTAMP(3),
    "linked_task_id" UUID,
    "status" "ApplicationRequirementStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "application_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "linked_task_id" UUID,
    "converted_task_id" UUID,
    "category" VARCHAR(64) NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "context" VARCHAR(4000) NOT NULL,
    "priority" VARCHAR(32),
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "submitted_by" UUID NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manager_response" VARCHAR(4000),
    "responded_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "issue_id" UUID NOT NULL,
    "action" "IssueLogAction" NOT NULL,
    "note" VARCHAR(4000),
    "operator_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient_id" UUID NOT NULL,
    "event_type" "NotificationEventType" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" VARCHAR(1000) NOT NULL,
    "object_type" VARCHAR(64),
    "object_id" UUID,
    "action_url" VARCHAR(500),
    "event_key" VARCHAR(255),
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_confirmations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "student_id" UUID NOT NULL,
    "object_type" VARCHAR(64) NOT NULL,
    "object_id" UUID,
    "prompt" VARCHAR(1000) NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "response_note" VARCHAR(1000),
    "responded_by" UUID,
    "responded_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "student_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" VARCHAR(500) NOT NULL,
    "file_hash" CHAR(64) NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_scores_student_id_score_type_idx" ON "student_scores"("student_id", "score_type");

-- CreateIndex
CREATE UNIQUE INDEX "student_scores_student_id_subject_name_score_type_key" ON "student_scores"("student_id", "subject_name", "score_type");

-- CreateIndex
CREATE INDEX "student_targets_student_id_status_idx" ON "student_targets"("student_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "material_types_code_key" ON "material_types"("code");

-- CreateIndex
CREATE INDEX "material_types_is_active_name_idx" ON "material_types"("is_active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "material_items_current_version_id_key" ON "material_items"("current_version_id");

-- CreateIndex
CREATE INDEX "material_items_student_id_status_due_at_idx" ON "material_items"("student_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "material_items_owner_id_status_idx" ON "material_items"("owner_id", "status");

-- CreateIndex
CREATE INDEX "material_items_archive_status_updated_at_idx" ON "material_items"("archive_status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_items_student_id_material_type_id_key" ON "material_items"("student_id", "material_type_id");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_storage_key_key" ON "material_versions"("storage_key");

-- CreateIndex
CREATE INDEX "material_versions_material_item_id_uploaded_at_idx" ON "material_versions"("material_item_id", "uploaded_at");

-- CreateIndex
CREATE INDEX "material_versions_review_status_uploaded_at_idx" ON "material_versions"("review_status", "uploaded_at");

-- CreateIndex
CREATE UNIQUE INDEX "material_versions_material_item_id_version_no_key" ON "material_versions"("material_item_id", "version_no");

-- CreateIndex
CREATE INDEX "material_followups_material_item_id_followed_at_idx" ON "material_followups"("material_item_id", "followed_at");

-- CreateIndex
CREATE INDEX "material_followups_task_id_idx" ON "material_followups"("task_id");

-- CreateIndex
CREATE INDEX "applications_student_id_status_deadline_at_idx" ON "applications"("student_id", "status", "deadline_at");

-- CreateIndex
CREATE INDEX "applications_owner_id_status_idx" ON "applications"("owner_id", "status");

-- CreateIndex
CREATE INDEX "applications_channel_status_last_updated_at_idx" ON "applications"("channel", "status", "last_updated_at");

-- CreateIndex
CREATE INDEX "application_status_logs_application_id_changed_at_idx" ON "application_status_logs"("application_id", "changed_at");

-- CreateIndex
CREATE INDEX "application_requirements_application_id_status_due_at_idx" ON "application_requirements"("application_id", "status", "due_at");

-- CreateIndex
CREATE INDEX "application_requirements_linked_task_id_idx" ON "application_requirements"("linked_task_id");

-- CreateIndex
CREATE INDEX "issues_student_id_status_updated_at_idx" ON "issues"("student_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "issues_submitted_by_status_idx" ON "issues"("submitted_by", "status");

-- CreateIndex
CREATE INDEX "issue_logs_issue_id_created_at_idx" ON "issue_logs"("issue_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_event_key_key" ON "notifications"("event_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_created_at_idx" ON "notifications"("recipient_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_event_type_created_at_idx" ON "notifications"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "student_confirmations_student_id_status_due_at_idx" ON "student_confirmations"("student_id", "status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "task_evidence_storage_key_key" ON "task_evidence"("storage_key");

-- CreateIndex
CREATE INDEX "task_evidence_task_id_created_at_idx" ON "task_evidence"("task_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "students_portal_user_id_key" ON "students"("portal_user_id");

-- CreateIndex
CREATE INDEX "students_school_grade_cohort_year_idx" ON "students"("school", "grade", "cohort_year");

-- CreateIndex
CREATE INDEX "students_risk_level_updated_at_idx" ON "students"("risk_level", "updated_at");

-- CreateIndex
CREATE INDEX "task_instances_source_type_source_object_id_idx" ON "task_instances"("source_type", "source_object_id");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_scores" ADD CONSTRAINT "student_scores_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_scores" ADD CONSTRAINT "student_scores_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_targets" ADD CONSTRAINT "student_targets_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_targets" ADD CONSTRAINT "student_targets_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_material_type_id_fkey" FOREIGN KEY ("material_type_id") REFERENCES "material_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_items" ADD CONSTRAINT "material_items_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "material_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_material_item_id_fkey" FOREIGN KEY ("material_item_id") REFERENCES "material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_followups" ADD CONSTRAINT "material_followups_material_item_id_fkey" FOREIGN KEY ("material_item_id") REFERENCES "material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_followups" ADD CONSTRAINT "material_followups_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_followups" ADD CONSTRAINT "material_followups_followed_by_fkey" FOREIGN KEY ("followed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_logs" ADD CONSTRAINT "application_status_logs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_status_logs" ADD CONSTRAINT "application_status_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_requirements" ADD CONSTRAINT "application_requirements_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_requirements" ADD CONSTRAINT "application_requirements_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "task_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_linked_task_id_fkey" FOREIGN KEY ("linked_task_id") REFERENCES "task_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_converted_task_id_fkey" FOREIGN KEY ("converted_task_id") REFERENCES "task_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_logs" ADD CONSTRAINT "issue_logs_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_logs" ADD CONSTRAINT "issue_logs_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_confirmations" ADD CONSTRAINT "student_confirmations_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_confirmations" ADD CONSTRAINT "student_confirmations_responded_by_fkey" FOREIGN KEY ("responded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "service_progress_calculation_runs_service_activation_id_started" RENAME TO "service_progress_calculation_runs_service_activation_id_sta_idx";

-- RenameIndex
ALTER INDEX "stage_instances_service_activation_id_status_sequence_no_snapsh" RENAME TO "stage_instances_service_activation_id_status_sequence_no_sn_idx";

-- RenameIndex
ALTER INDEX "task_instances_stage_instance_id_is_blocking_snapshot_status_id" RENAME TO "task_instances_stage_instance_id_is_blocking_snapshot_statu_idx";

-- Seed V1.0 permissions without depending on the development seed command.
INSERT INTO "permissions" ("id", "permission_code", "permission_name", "description", "created_at")
VALUES
  (gen_random_uuid(), 'students.planning.write', '维护学生学情与升学目标', '规划老师或管理员维护本人负责学生的成绩与目标', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'materials.read', '查看资料', '按学生关系或全局权限查看资料与版本', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'materials.write', '维护资料', '创建资料项、上传版本和记录缺失计划', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'materials.review', '审核资料', '审核资料版本、记录补交要求和归档状态', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'applications.read', '查看申请', '按学生关系或全局权限查看香港及JUPAS申请', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'applications.write', '维护申请', '创建申请、更新状态并创建节点任务', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'issues.read', '查看问题反馈', '查看本人学生或全局问题反馈', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'issues.write', '提交与补充问题', '提交问题、补充上下文和重新打开', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'issues.manage', '处理问题与专项任务', '回复、关闭或转化为专项任务', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'notifications.read', '查看站内通知', '查看和处理本人的站内通知', CURRENT_TIMESTAMP)
ON CONFLICT ("permission_code") DO UPDATE SET
  "permission_name" = EXCLUDED."permission_name",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."role_code" = 'ADMINISTRATOR'
  AND permission."permission_code" IN (
    'students.planning.write', 'materials.read', 'materials.write', 'materials.review',
    'applications.read', 'applications.write', 'issues.read', 'issues.write',
    'issues.manage', 'notifications.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."role_code" = 'BUTLER'
  AND permission."permission_code" IN (
    'materials.read', 'materials.write', 'materials.review',
    'applications.read', 'applications.write',
    'issues.read', 'issues.write', 'notifications.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."role_code" = 'PLANNER'
  AND permission."permission_code" IN (
    'workspace.access', 'students.own.read', 'students.planning.write',
    'materials.read', 'applications.read', 'notifications.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."role_code" = 'SPECIALIST'
  AND permission."permission_code" IN (
    'workspace.access', 'tasks.own.read', 'tasks.own.write', 'issues.read', 'notifications.read'
  )
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role
CROSS JOIN "permissions" permission
WHERE role."role_code" = 'STUDENT'
  AND permission."permission_code" = 'notifications.read'
ON CONFLICT DO NOTHING;

-- A configurable starter checklist. Administrators can extend or deactivate it later.
INSERT INTO "material_types" (
  "id", "code", "name", "description", "is_core", "is_active", "created_at", "updated_at"
)
VALUES
  (gen_random_uuid(), 'IDENTITY', '身份证明', '香港身份证、护照或其他申请所需身份证明', TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRANSCRIPT', '在校成绩单', '最新正式成绩单及历史成绩记录', TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PREDICTED_GRADES', '预测成绩', '学校或老师出具的预测成绩', TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ACTIVITY_EVIDENCE', '活动与获奖证明', '活动、比赛、奖项及背景提升证明', FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PERSONAL_STATEMENT', '个人陈述素材', '文书准备所需的经历、动机与素材', TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RECOMMENDATION', '推荐信资料', '推荐人信息及推荐信相关材料', FALSE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
