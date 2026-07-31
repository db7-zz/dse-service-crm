import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S1 administrator role migration", () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const username = `legacy-manager-${randomUUID()}`;
  let userId: string;
  let auditId: string;

  beforeAll(async () => {
    const userResult = await pool.query<{ id: string }>(
      `INSERT INTO "users" (
        "username",
        "display_name",
        "password_hash",
        "status",
        "updated_at"
      )
      VALUES ($1, '历史负责人', 'not-used-by-this-test', 'ACTIVE', CURRENT_TIMESTAMP)
      RETURNING "id"`,
      [username],
    );
    userId = userResult.rows[0]!.id;

    await pool.query(
      `INSERT INTO "user_roles" ("user_id", "role_id")
       SELECT $1, "id" FROM "roles" WHERE "role_code" = 'ERIC_MANAGER'`,
      [userId],
    );
    const auditResult = await pool.query<{ id: string }>(
      `INSERT INTO "audit_logs" (
        "operator_id",
        "operator_role",
        "object_type",
        "object_id",
        "action",
        "request_id"
      )
      VALUES (
        $1::uuid,
        'ERIC_MANAGER',
        'migration-test',
        $1::text,
        'HISTORICAL_ACTION',
        $2
      )
      RETURNING "id"`,
      [userId, randomUUID()],
    );
    auditId = auditResult.rows[0]!.id;
  });

  afterAll(async () => {
    if (auditId) {
      await pool.query(`DELETE FROM "audit_logs" WHERE "id" = $1`, [auditId]);
    }
    if (userId) {
      await pool.query(`DELETE FROM "users" WHERE "id" = $1`, [userId]);
    }
    await pool.end();
  });

  it("is idempotent, keeps one user, and preserves the historical audit role", async () => {
    const migration = await readFile(
      new URL(
        "../migrations/20260730000100_s1_admin_role_permissions/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await pool.query(migration);
    await pool.query(migration);

    const result = await pool.query<{
      user_count: number;
      administrator_count: number;
      active_legacy_count: number;
      expired_legacy_count: number;
      audit_role: string;
    }>(
      `SELECT
        (SELECT COUNT(*)::int FROM "users" WHERE "id" = $1) AS "user_count",
        (
          SELECT COUNT(*)::int
          FROM "user_roles" AS relation
          INNER JOIN "roles" AS role ON role."id" = relation."role_id"
          WHERE relation."user_id" = $1
            AND role."role_code" = 'ADMINISTRATOR'
            AND relation."expired_at" IS NULL
        ) AS "administrator_count",
        (
          SELECT COUNT(*)::int
          FROM "user_roles" AS relation
          INNER JOIN "roles" AS role ON role."id" = relation."role_id"
          WHERE relation."user_id" = $1
            AND role."role_code" = 'ERIC_MANAGER'
            AND relation."expired_at" IS NULL
        ) AS "active_legacy_count",
        (
          SELECT COUNT(*)::int
          FROM "user_roles" AS relation
          INNER JOIN "roles" AS role ON role."id" = relation."role_id"
          WHERE relation."user_id" = $1
            AND role."role_code" = 'ERIC_MANAGER'
            AND relation."expired_at" IS NOT NULL
        ) AS "expired_legacy_count",
        (
          SELECT "operator_role"
          FROM "audit_logs"
          WHERE "id" = $2
        ) AS "audit_role"`,
      [userId, auditId],
    );

    expect(result.rows[0]).toEqual({
      user_count: 1,
      administrator_count: 1,
      active_legacy_count: 0,
      expired_legacy_count: 1,
      audit_role: "ERIC_MANAGER",
    });
  });

  it("assigns S1 permissions only to the administrator and butler roles", async () => {
    const result = await pool.query<{ role_code: string; permission_code: string }>(
      `SELECT role."role_code", permission."permission_code"
       FROM "role_permissions" AS relation
       INNER JOIN "roles" AS role ON role."id" = relation."role_id"
       INNER JOIN "permissions" AS permission ON permission."id" = relation."permission_id"
       WHERE permission."permission_code" IN (
         'students.read',
         'students.write',
         'sop.read',
         'sop.write',
         'service.activation.write',
         'tasks.own.read',
         'tasks.own.write',
         'tasks.supervision.read',
         'tasks.supervision.write',
         'overdue-alerts.read',
         'overdue-alerts.write'
       )
       ORDER BY role."role_code", permission."permission_code"`,
    );

    const permissionsByRole = result.rows.reduce((grouped, row) => {
      const permissions = grouped.get(row.role_code) ?? [];
      permissions.push(row.permission_code);
      grouped.set(row.role_code, permissions);
      return grouped;
    }, new Map<string, string[]>());
    expect(permissionsByRole.get("ADMINISTRATOR")).toEqual([
      "overdue-alerts.read",
      "overdue-alerts.write",
      "service.activation.write",
      "sop.read",
      "sop.write",
      "students.read",
      "students.write",
      "tasks.supervision.read",
      "tasks.supervision.write",
    ]);
    expect(permissionsByRole.get("BUTLER")).toEqual(["tasks.own.read", "tasks.own.write"]);
    expect(permissionsByRole.has("ERIC_MANAGER")).toBe(false);
    expect(permissionsByRole.has("PLANNER")).toBe(false);

    const legacyPermissionCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS "count"
       FROM "role_permissions" AS relation
       INNER JOIN "roles" AS role ON role."id" = relation."role_id"
       WHERE role."role_code" = 'ERIC_MANAGER'`,
    );
    expect(legacyPermissionCount.rows[0]!.count).toBe(0);
  });
});
