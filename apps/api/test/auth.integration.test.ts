import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@dse/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S0 authentication and authorization", () => {
  let app: INestApplication;

  beforeAll(async () => {
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

    const response = await agent.get("/api/v1/admin/users").expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");

    const { PRISMA } = await import("../src/database/database.module.js");
    const prisma = app.get<PrismaClient>(PRISMA);
    await expect(
      prisma.auditLog.findFirst({
        where: {
          action: "PERMISSION_DENIED",
          requestId: response.body.requestId,
        },
      }),
    ).resolves.not.toBeNull();
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
