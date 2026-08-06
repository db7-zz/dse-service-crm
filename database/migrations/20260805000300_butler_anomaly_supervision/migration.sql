-- CreateEnum
CREATE TYPE "StudentBlockerStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'RESOLVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ButlerAnomalyType" AS ENUM ('TASK_OVERDUE_UNREPORTED', 'STUDENT_BLOCKER_FOLLOWUP_MISSED', 'STUDENT_BLOCKER_REJECTED', 'WEEKLY_RESPONSE_OVERDUE');

-- CreateEnum
CREATE TYPE "ButlerAnomalyStatus" AS ENUM ('OPEN', 'RECTIFIED', 'APPEAL_ACCEPTED', 'APPEAL_REJECTED');

-- CreateEnum
CREATE TYPE "ButlerWeeklyReviewStatus" AS ENUM ('LIVE', 'PENDING_RESPONSE', 'PENDING_REVIEW', 'CLOSED');

-- AlterEnum
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'STUDENT_BLOCKER_REPORTED';
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'STUDENT_BLOCKER_UPDATED';
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'STUDENT_BLOCKER_REJECTED';
ALTER TYPE "TaskTimelineEventType" ADD VALUE 'STUDENT_BLOCKER_RESOLVED';

-- CreateTable
CREATE TABLE "task_student_blockers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "task_id" UUID NOT NULL,
    "reported_by" UUID NOT NULL,
    "category" VARCHAR(64) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "expected_recovery_at" TIMESTAMP(3) NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_in_time" BOOLEAN NOT NULL,
    "status" "StudentBlockerStatus" NOT NULL DEFAULT 'ACTIVE',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" VARCHAR(1000),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "task_student_blockers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "butler_anomalies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "butler_id" UUID NOT NULL,
    "task_id" UUID,
    "blocker_id" UUID,
    "type" "ButlerAnomalyType" NOT NULL,
    "status" "ButlerAnomalyStatus" NOT NULL DEFAULT 'OPEN',
    "source_key" VARCHAR(255) NOT NULL,
    "title_snapshot" VARCHAR(200) NOT NULL,
    "student_id_snapshot" UUID,
    "student_no_snapshot" VARCHAR(32),
    "student_name_snapshot" VARCHAR(100),
    "deadline_snapshot" TIMESTAMP(3),
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "fact_detail" JSONB,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" VARCHAR(2000),
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butler_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "butler_weekly_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "butler_id" UUID NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "status" "ButlerWeeklyReviewStatus" NOT NULL DEFAULT 'LIVE',
    "frozen_at" TIMESTAMP(3),
    "response_due_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "review_note" VARCHAR(2000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "butler_weekly_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "butler_weekly_review_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "review_id" UUID NOT NULL,
    "anomaly_id" UUID NOT NULL,
    "item_kind" VARCHAR(16) NOT NULL,
    "response_note" VARCHAR(2000),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "butler_weekly_review_items_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "task_student_blockers_task_id_status_expected_recovery_at_idx" ON "task_student_blockers"("task_id", "status", "expected_recovery_at");
CREATE INDEX "task_student_blockers_reported_by_status_idx" ON "task_student_blockers"("reported_by", "status");
CREATE UNIQUE INDEX "butler_anomalies_source_key_key" ON "butler_anomalies"("source_key");
CREATE INDEX "butler_anomalies_butler_id_occurred_at_idx" ON "butler_anomalies"("butler_id", "occurred_at");
CREATE INDEX "butler_anomalies_butler_id_status_resolved_at_idx" ON "butler_anomalies"("butler_id", "status", "resolved_at");
CREATE INDEX "butler_anomalies_task_id_type_idx" ON "butler_anomalies"("task_id", "type");
CREATE UNIQUE INDEX "butler_weekly_reviews_butler_id_week_start_key" ON "butler_weekly_reviews"("butler_id", "week_start");
CREATE INDEX "butler_weekly_reviews_status_week_start_idx" ON "butler_weekly_reviews"("status", "week_start");
CREATE UNIQUE INDEX "butler_weekly_review_items_review_id_anomaly_id_key" ON "butler_weekly_review_items"("review_id", "anomaly_id");
CREATE INDEX "butler_weekly_review_items_anomaly_id_idx" ON "butler_weekly_review_items"("anomaly_id");

-- ForeignKeys
ALTER TABLE "task_student_blockers" ADD CONSTRAINT "task_student_blockers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_student_blockers" ADD CONSTRAINT "task_student_blockers_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_student_blockers" ADD CONSTRAINT "task_student_blockers_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butler_anomalies" ADD CONSTRAINT "butler_anomalies_butler_id_fkey" FOREIGN KEY ("butler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "butler_anomalies" ADD CONSTRAINT "butler_anomalies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "butler_anomalies" ADD CONSTRAINT "butler_anomalies_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "task_student_blockers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "butler_anomalies" ADD CONSTRAINT "butler_anomalies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butler_weekly_reviews" ADD CONSTRAINT "butler_weekly_reviews_butler_id_fkey" FOREIGN KEY ("butler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "butler_weekly_reviews" ADD CONSTRAINT "butler_weekly_reviews_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "butler_weekly_review_items" ADD CONSTRAINT "butler_weekly_review_items_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "butler_weekly_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "butler_weekly_review_items" ADD CONSTRAINT "butler_weekly_review_items_anomaly_id_fkey" FOREIGN KEY ("anomaly_id") REFERENCES "butler_anomalies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
