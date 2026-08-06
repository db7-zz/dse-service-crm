-- Progressive onboarding: the account and service start before the complete profile.
CREATE TYPE "StudentHandoffStatus" AS ENUM ('PENDING_ACCEPTANCE', 'ACCEPTED', 'CANCELED');
CREATE TYPE "StudentProfileStatus" AS ENUM ('INFORMATION_PENDING', 'PENDING_REVIEW', 'CONFIRMED', 'PLANNER_ASSIGNED');
CREATE TYPE "MaterialInputMode" AS ENUM ('FILE', 'FORM', 'SECURE_REFERENCE');
CREATE TYPE "MaterialCollectionPhase" AS ENUM ('CURRENT', 'LATER');

ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'HANDOFF_ASSIGNED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'HANDOFF_ACCEPTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PROFILE_SUBMITTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PLANNER_ASSIGNMENT_REQUESTED';
ALTER TYPE "NotificationEventType" ADD VALUE IF NOT EXISTS 'PLANNER_ASSIGNED';

ALTER TABLE "students"
  ADD COLUMN "student_wechat" VARCHAR(100),
  ADD COLUMN "parent_name" VARCHAR(100),
  ADD COLUMN "parent_relationship" VARCHAR(50),
  ADD COLUMN "parent_phone" VARCHAR(32),
  ADD COLUMN "parent_wechat" VARCHAR(100),
  ADD COLUMN "identity_category" VARCHAR(100),
  ADD COLUMN "exam_candidate_type" VARCHAR(100),
  ADD COLUMN "dse_subjects" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "score_summary" VARCHAR(1000),
  ADD COLUMN "target_direction" VARCHAR(1000),
  ADD COLUMN "profile_status" "StudentProfileStatus" NOT NULL DEFAULT 'INFORMATION_PENDING',
  ADD COLUMN "profile_confirmed_at" TIMESTAMP(3);

ALTER TABLE "material_types"
  ADD COLUMN "input_mode" "MaterialInputMode" NOT NULL DEFAULT 'FILE',
  ADD COLUMN "collection_phase" "MaterialCollectionPhase" NOT NULL DEFAULT 'CURRENT',
  ADD COLUMN "sequence_no" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "signed_student_handoffs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_name" VARCHAR(100) NOT NULL,
  "student_phone" VARCHAR(32),
  "student_wechat" VARCHAR(100),
  "parent_name" VARCHAR(100) NOT NULL,
  "parent_relationship" VARCHAR(50),
  "parent_phone" VARCHAR(32) NOT NULL,
  "parent_wechat" VARCHAR(100),
  "school" VARCHAR(150),
  "grade" VARCHAR(32),
  "cohort_year" INTEGER,
  "assigned_butler_id" UUID NOT NULL,
  "wechat_group_created_at" TIMESTAMP(3) NOT NULL,
  "status" "StudentHandoffStatus" NOT NULL DEFAULT 'PENDING_ACCEPTANCE',
  "student_id" UUID,
  "accepted_by_id" UUID,
  "accepted_at" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "signed_student_handoffs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "student_profile_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "student_id" UUID NOT NULL,
  "data" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "submitted_at" TIMESTAMP(3) NOT NULL,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "student_profile_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "signed_student_handoffs_student_id_key" ON "signed_student_handoffs"("student_id");
CREATE INDEX "signed_student_handoffs_status_created_at_idx" ON "signed_student_handoffs"("status", "created_at");
CREATE INDEX "signed_student_handoffs_assigned_butler_id_status_created_at_idx" ON "signed_student_handoffs"("assigned_butler_id", "status", "created_at");
CREATE UNIQUE INDEX "student_profile_submissions_student_id_key" ON "student_profile_submissions"("student_id");
CREATE INDEX "student_profile_submissions_submitted_at_idx" ON "student_profile_submissions"("submitted_at");

ALTER TABLE "signed_student_handoffs" ADD CONSTRAINT "signed_student_handoffs_assigned_butler_id_fkey" FOREIGN KEY ("assigned_butler_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "signed_student_handoffs" ADD CONSTRAINT "signed_student_handoffs_accepted_by_id_fkey" FOREIGN KEY ("accepted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "signed_student_handoffs" ADD CONSTRAINT "signed_student_handoffs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "signed_student_handoffs" ADD CONSTRAINT "signed_student_handoffs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "student_profile_submissions" ADD CONSTRAINT "student_profile_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_profile_submissions" ADD CONSTRAINT "student_profile_submissions_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A planner is assigned only after the butler confirms the profile.
ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "students_enabled_onboarding_complete_check";
ALTER TABLE "students" ADD CONSTRAINT "students_enabled_onboarding_complete_check"
CHECK (
  "service_status" <> 'ENABLED'
  OR ("portal_user_id" IS NOT NULL AND "default_butler_id" IS NOT NULL)
) NOT VALID;

INSERT INTO "permissions" ("id", "permission_code", "permission_name", "description", "created_at")
VALUES
  (gen_random_uuid(), 'student-handoffs.read', '查看签约交接', '查看本人负责或全部签约学生交接', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'student-handoffs.write', '创建签约交接', '管理员创建签约学生交接并分配管家', CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'students.own.write', '维护本人学生', '管家接手、开通账号并确认本人学生档案', CURRENT_TIMESTAMP)
ON CONFLICT ("permission_code") DO UPDATE SET
  "permission_name" = EXCLUDED."permission_name",
  "description" = EXCLUDED."description";

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role CROSS JOIN "permissions" permission
WHERE role."role_code" = 'ADMINISTRATOR'
  AND permission."permission_code" IN ('student-handoffs.read', 'student-handoffs.write')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT role."id", permission."id"
FROM "roles" role CROSS JOIN "permissions" permission
WHERE role."role_code" = 'BUTLER'
  AND permission."permission_code" IN ('student-handoffs.read', 'students.own.write')
ON CONFLICT DO NOTHING;

-- Real 2027 DSE collection checklist. Later-phase items are visible but collapsed.
INSERT INTO "material_types" ("id", "code", "name", "description", "is_core", "is_active", "input_mode", "collection_phase", "sequence_no", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'BASIC_INFORMATION', '基本信息表', '由学生或家长在线填写，管家确认后写入正式档案', TRUE, TRUE, 'FORM', 'CURRENT', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'SELF_RECOMMENDATION', '自荐信素材', '学生填写的自荐信及文书素材', TRUE, TRUE, 'FILE', 'CURRENT', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'TRANSCRIPT', '高中三年成绩单', '成绩单需包含年级排名；当前阶段可暂缓', TRUE, TRUE, 'FILE', 'LATER', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ENROLLMENT_PROOF', '在读证明', '由学校开具；当前阶段可暂缓', TRUE, TRUE, 'FILE', 'LATER', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RECOMMENDATION', '推荐信素材', '学生填写或上传推荐信相关素材', FALSE, TRUE, 'FILE', 'CURRENT', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'IDENTITY', '身份证明', '按实际情况上传身份证、护照或港澳通行证彩色正反面扫描件', TRUE, TRUE, 'FILE', 'CURRENT', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PROFILE_PHOTO', '近照免冠照电子版', '1张白底或蓝底免冠证件照', TRUE, TRUE, 'FILE', 'CURRENT', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'ACTIVITY_EVIDENCE', '社会实践及获奖证明', '高中阶段活动、比赛、奖项证明及活动照片', FALSE, TRUE, 'FILE', 'CURRENT', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'PREDICTED_GRADES', '预估及正式成绩单', '由学校开具；当前阶段可暂缓', TRUE, TRUE, 'FILE', 'LATER', 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'EXAM_CHECKLIST', 'CHECKLIST及准考证', '收到后再上传；当前阶段可暂缓', FALSE, TRUE, 'FILE', 'LATER', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'RESUME', '简历（如有）', '如已有简历可上传，没有可标记不适用', FALSE, TRUE, 'FILE', 'CURRENT', 11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HKEAA_ACCOUNT', '考评局系统账号（如有）', '敏感凭证不作为普通文件或备注保存，请通过安全渠道提供', FALSE, TRUE, 'SECURE_REFERENCE', 'LATER', 12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'JUPAS_ACCOUNT', 'JUPAS系统账号（如有）', '敏感凭证不作为普通文件或备注保存，请通过安全渠道提供', FALSE, TRUE, 'SECURE_REFERENCE', 'LATER', 13, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'LANGUAGE_SCORE', '雅思或托福成绩（如有）', '如有雅思或托福成绩请上传，没有可标记不适用', FALSE, TRUE, 'FILE', 'CURRENT', 14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_core" = EXCLUDED."is_core",
  "is_active" = EXCLUDED."is_active",
  "input_mode" = EXCLUDED."input_mode",
  "collection_phase" = EXCLUDED."collection_phase",
  "sequence_no" = EXCLUDED."sequence_no";

UPDATE "material_types" SET "is_active" = FALSE WHERE "code" = 'PERSONAL_STATEMENT';
