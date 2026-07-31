CREATE TYPE "StudentServiceStatus" AS ENUM ('NOT_ENABLED', 'ENABLED');
CREATE TYPE "StudentResponsibilityType" AS ENUM ('DEFAULT_BUTLER', 'PLANNER');

CREATE SEQUENCE "student_number_seq" START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE "students" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_no" VARCHAR(24) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "phone" VARCHAR(32),
  "email" VARCHAR(254),
  "default_butler_id" UUID,
  "planner_id" UUID,
  "service_status" "StudentServiceStatus" NOT NULL DEFAULT 'NOT_ENABLED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "students_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_responsibility_changes" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "responsibility_type" "StudentResponsibilityType" NOT NULL,
  "previous_user_id" UUID,
  "new_user_id" UUID,
  "reason" VARCHAR(500) NOT NULL,
  "operator_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "student_responsibility_changes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "students_student_no_key" ON "students"("student_no");
CREATE INDEX "students_name_idx" ON "students"("name");
CREATE INDEX "students_service_status_created_at_idx" ON "students"("service_status", "created_at");
CREATE INDEX "students_default_butler_id_idx" ON "students"("default_butler_id");
CREATE INDEX "students_planner_id_idx" ON "students"("planner_id");
CREATE INDEX "student_responsibility_changes_student_id_created_at_idx"
  ON "student_responsibility_changes"("student_id", "created_at");
CREATE INDEX "student_responsibility_changes_operator_id_idx"
  ON "student_responsibility_changes"("operator_id");

ALTER TABLE "students"
  ADD CONSTRAINT "students_default_butler_id_fkey"
  FOREIGN KEY ("default_butler_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "students"
  ADD CONSTRAINT "students_planner_id_fkey"
  FOREIGN KEY ("planner_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "students"
  ADD CONSTRAINT "students_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "student_responsibility_changes"
  ADD CONSTRAINT "student_responsibility_changes_student_id_fkey"
  FOREIGN KEY ("student_id") REFERENCES "students"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_responsibility_changes"
  ADD CONSTRAINT "student_responsibility_changes_previous_user_id_fkey"
  FOREIGN KEY ("previous_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_responsibility_changes"
  ADD CONSTRAINT "student_responsibility_changes_new_user_id_fkey"
  FOREIGN KEY ("new_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "student_responsibility_changes"
  ADD CONSTRAINT "student_responsibility_changes_operator_id_fkey"
  FOREIGN KEY ("operator_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
