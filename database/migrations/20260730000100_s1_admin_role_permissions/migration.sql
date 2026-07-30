INSERT INTO "permissions" ("permission_code", "permission_name", "description")
VALUES
  ('students.read', '查看学生最小档案', '查看S1学生最小档案和负责人关系'),
  ('students.write', '维护学生最小档案', '创建、编辑学生和维护负责人关系'),
  ('sop.read', '查看SOP版本', '查看SOP版本、阶段和任务模板'),
  ('sop.write', '维护SOP版本', '创建、编辑、校验和发布SOP版本'),
  ('service.activation.write', '启用学生服务', '为学生启用服务并套用已发布SOP'),
  ('tasks.own.read', '查看本人任务', '查看本人负责的任务及关联学生最小信息'),
  ('tasks.own.write', '执行本人任务', '开始、更新、延期报备和完成本人任务'),
  ('tasks.supervision.read', '查看任务监督数据', '查看全部任务、时间线和监督统计'),
  ('tasks.supervision.write', '介入监督任务', '改期、转派和取消任务'),
  ('overdue-alerts.read', '查看逾期提醒', '查看逾期任务提醒'),
  ('overdue-alerts.write', '处理逾期提醒', '标记和处理逾期任务提醒')
ON CONFLICT ("permission_code") DO UPDATE
SET
  "permission_name" = EXCLUDED."permission_name",
  "description" = EXCLUDED."description";

UPDATE "roles"
SET
  "role_name" = '管理员',
  "description" = '维护账号、角色、权限、审计和S1业务'
WHERE "role_code" = 'ADMINISTRATOR';

UPDATE "roles"
SET
  "role_name" = '历史业务负责人',
  "description" = '仅为历史审计保留，不再用于新账号分配'
WHERE "role_code" = 'ERIC_MANAGER';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT administrator."id", permission."id"
FROM "roles" AS administrator
CROSS JOIN "permissions" AS permission
WHERE administrator."role_code" = 'ADMINISTRATOR'
  AND permission."permission_code" IN (
    'students.read',
    'students.write',
    'sop.read',
    'sop.write',
    'service.activation.write',
    'tasks.supervision.read',
    'tasks.supervision.write',
    'overdue-alerts.read',
    'overdue-alerts.write'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT butler."id", permission."id"
FROM "roles" AS butler
CROSS JOIN "permissions" AS permission
WHERE butler."role_code" = 'BUTLER'
  AND permission."permission_code" IN (
    'tasks.own.read',
    'tasks.own.write'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

DELETE FROM "role_permissions"
WHERE "role_id" = (
  SELECT "id"
  FROM "roles"
  WHERE "role_code" = 'ERIC_MANAGER'
);

INSERT INTO "user_roles" ("user_id", "role_id", "effective_at", "expired_at")
SELECT
  legacy_relation."user_id",
  administrator."id",
  legacy_relation."effective_at",
  NULL
FROM "user_roles" AS legacy_relation
INNER JOIN "roles" AS legacy_role
  ON legacy_role."id" = legacy_relation."role_id"
CROSS JOIN "roles" AS administrator
WHERE legacy_role."role_code" = 'ERIC_MANAGER'
  AND administrator."role_code" = 'ADMINISTRATOR'
  AND legacy_relation."expired_at" IS NULL
ON CONFLICT ("user_id", "role_id") DO UPDATE
SET
  "effective_at" = LEAST("user_roles"."effective_at", EXCLUDED."effective_at"),
  "expired_at" = NULL;

UPDATE "user_roles" AS legacy_relation
SET "expired_at" = CURRENT_TIMESTAMP
FROM "roles" AS legacy_role
WHERE legacy_role."id" = legacy_relation."role_id"
  AND legacy_role."role_code" = 'ERIC_MANAGER'
  AND legacy_relation."expired_at" IS NULL;
