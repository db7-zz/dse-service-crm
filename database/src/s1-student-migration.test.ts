import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S1 student management migration", () => {
  const pool = new Pool({ connectionString: testDatabaseUrl });
  const studentNo = `DSE-TEST-${randomUUID().slice(0, 8)}`;
  let administratorId: string;
  let studentId: string;

  beforeAll(async () => {
    const administrator = await pool.query<{ id: string }>(
      `SELECT user_account."id"
       FROM "users" AS user_account
       INNER JOIN "user_roles" AS relation ON relation."user_id" = user_account."id"
       INNER JOIN "roles" AS role ON role."id" = relation."role_id"
       WHERE role."role_code" = 'ADMINISTRATOR'
         AND relation."expired_at" IS NULL
       LIMIT 1`,
    );
    administratorId = administrator.rows[0]!.id;
  });

  afterAll(async () => {
    if (studentId) {
      await pool.query(`DELETE FROM "students" WHERE "id" = $1`, [studentId]);
    }
    await pool.end();
  });

  it("defaults service state and version for a minimal student record", async () => {
    const result = await pool.query<{
      id: string;
      service_status: string;
      version: number;
    }>(
      `INSERT INTO "students" ("student_no", "name", "created_by")
       VALUES ($1, '数据库迁移测试学生', $2)
       RETURNING "id", "service_status", "version"`,
      [studentNo, administratorId],
    );
    studentId = result.rows[0]!.id;
    expect(result.rows[0]).toMatchObject({
      service_status: "NOT_ENABLED",
      version: 1,
    });
  });

  it("enforces a unique student number at the database boundary", async () => {
    await expect(
      pool.query(
        `INSERT INTO "students" ("student_no", "name", "created_by")
         VALUES ($1, '重复编号学生', $2)`,
        [studentNo, administratorId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
