import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@dse/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./test-database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("authentication and S1 authorization baseline", () => {
  let app: INestApplication;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(testDatabaseUrl!);
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl!;

    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import("../src/app.module.js"),
      import("../src/bootstrap.js"),
    ]);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("wraps unauthenticated responses and returns a request id", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/auth/me").expect(401);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      error: {
        code: "UNAUTHENTICATED",
      },
    });
    expect(response.body.requestId).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).toBe(response.body.requestId);
  });

  it("logs in an administrator using only a secure cookie", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        username: "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.user.roles).toContain("ADMINISTRATOR");
    expect(response.body.data.user.permissions).toEqual(
      expect.arrayContaining([
        "students.read",
        "students.write",
        "sop.read",
        "sop.write",
        "service.activation.write",
        "tasks.supervision.read",
        "tasks.supervision.write",
        "overdue-alerts.read",
        "overdue-alerts.write",
      ]),
    );
    expect(response.body.data.user.permissions).not.toContain("tasks.own.write");
    expect(response.body.data).not.toHaveProperty("token");
    expect(String(response.headers["set-cookie"])).toContain("dse_session=");
  });

  it("keeps logout idempotent after the session cookie is cleared", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
      })
      .expect(201);
    const csrfResponse = await agent.get("/api/v1/auth/csrf").expect(200);
    await agent
      .post("/api/v1/auth/logout")
      .set("X-CSRF-Token", csrfResponse.body.data.csrfToken)
      .expect(201);
    const repeated = await agent.post("/api/v1/auth/logout").expect(201);
    expect(repeated.body.data).toEqual({ loggedOut: true });
  });

  it("rejects a butler from the administrator user API", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: "butler",
        password: process.env.SEED_BUTLER_PASSWORD ?? "ButlerPassword!2026",
      })
      .expect(201);

    const me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.permissions).toEqual(
      expect.arrayContaining(["tasks.own.read", "tasks.own.write"]),
    );
    expect(me.body.data.permissions).not.toContain("tasks.supervision.read");

    const response = await agent.get("/api/v1/admin/users").expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const { PRISMA } = await import("../src/database/database.module.js");
    const prisma = app.get<PrismaClient>(PRISMA);
    await expect(
      prisma.auditLog.findFirstOrThrow({
        where: {
          action: "PERMISSION_DENIED",
          requestId: response.body.requestId,
        },
      }),
    ).resolves.toMatchObject({
      operatorId: expect.any(String),
      operatorRole: "BUTLER",
      objectType: "permission",
      objectId: "system.users.read",
      action: "PERMISSION_DENIED",
      requestId: response.body.requestId,
    });
  });

  it("rejects the historical manager role for new assignments", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
      })
      .expect(201);
    const csrfResponse = await agent.get("/api/v1/auth/csrf").expect(200);

    const response = await agent
      .post("/api/v1/admin/users")
      .set("X-CSRF-Token", csrfResponse.body.data.csrfToken)
      .send({
        username: `legacy-role.${Date.now()}`,
        displayName: "不可分配的历史角色",
        password: "IntegrationPassword!2026",
        roleCodes: ["ERIC_MANAGER"],
      })
      .expect(400);

    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates, changes roles, disables, enables, and audits an account", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
      })
      .expect(201);
    const csrfResponse = await agent.get("/api/v1/auth/csrf").expect(200);
    const csrfToken = csrfResponse.body.data.csrfToken as string;
    const username = `integration.${Date.now()}`;

    const created = await agent
      .post("/api/v1/admin/users")
      .set("X-CSRF-Token", csrfToken)
      .send({
        username,
        displayName: "集成测试账号",
        password: "IntegrationPassword!2026",
        roleCodes: ["BUTLER"],
      })
      .expect(201);
    const userId = created.body.data.id as string;

    await agent
      .put(`/api/v1/admin/users/${userId}/roles`)
      .set("X-CSRF-Token", csrfToken)
      .send({
        roleCodes: ["PLANNER"],
        reason: "验证角色调整和审计记录",
      })
      .expect(200);

    const plannerAgent = request.agent(app.getHttpServer());
    await plannerAgent
      .post("/api/v1/auth/login")
      .send({ username, password: "IntegrationPassword!2026" })
      .expect(201);
    await plannerAgent.get("/api/v1/admin/users").expect(403);

    await agent
      .post(`/api/v1/admin/users/${userId}/disable`)
      .set("X-CSRF-Token", csrfToken)
      .send({ reason: "验证停用流程" })
      .expect(201);
    await agent
      .post(`/api/v1/admin/users/${userId}/enable`)
      .set("X-CSRF-Token", csrfToken)
      .send({ reason: "验证启用流程" })
      .expect(201);

    const audits = await agent
      .get("/api/v1/admin/audit-logs")
      .query({ objectType: "user", pageSize: 100 })
      .expect(200);
    const actions = audits.body.data.items
      .filter((event: { objectId: string }) => event.objectId === userId)
      .map((event: { action: string }) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "USER_CREATED",
        "USER_ROLES_CHANGED",
        "USER_DISABLED",
        "USER_ENABLED",
      ]),
    );
  });
});
