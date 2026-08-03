import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@dse/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./test-database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S1 student records and responsibility relationships", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const createdStudentIds: string[] = [];
  const createdUsernames: string[] = [];

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(testDatabaseUrl!);
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl!;

    const [{ AppModule }, { configureApplication }, { PRISMA }] = await Promise.all([
      import("../src/app.module.js"),
      import("../src/bootstrap.js"),
      import("../src/database/database.module.js"),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get<PrismaClient>(PRISMA);
  });

  afterAll(async () => {
    for (const studentId of createdStudentIds) {
      await prisma.student.delete({ where: { id: studentId } }).catch(() => undefined);
    }
    for (const username of createdUsernames) {
      await prisma.user.delete({ where: { username } }).catch(() => undefined);
    }
    await app?.close();
  });

  async function administratorAgent() {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: process.env.SEED_ADMIN_USERNAME ?? "admin",
        password: process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
      })
      .expect(201);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    return { agent, csrfToken: csrf.body.data.csrfToken as string };
  }

  it("creates a minimal student, assigns both owners, preserves history, and rejects stale writes", async () => {
    const { agent, csrfToken } = await administratorAgent();

    const created = await agent
      .post("/api/v1/students")
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "黄翰" })
      .expect(201);
    const student = created.body.data as {
      id: string;
      studentNo: string;
      serviceStatus: string;
      defaultButler: null;
      planner: null;
      version: number;
    };
    createdStudentIds.push(student.id);
    expect(student).toMatchObject({
      serviceStatus: "NOT_ENABLED",
      defaultButler: null,
      planner: null,
      version: 1,
    });
    expect(student.studentNo).toMatch(/^DSE-\d{4}-\d{6}$/);

    const listed = await agent
      .get("/api/v1/students")
      .query({ search: student.studentNo, page: 999, pageSize: 1 })
      .expect(200);
    expect(listed.body.data).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(listed.body.data.items[0].id).toBe(student.id);

    const peopleBefore = await agent.get("/api/v1/students/responsible-person-options").expect(200);
    const butler = peopleBefore.body.data.butlers[0] as { id: string; displayName: string };
    expect(butler).toBeDefined();

    const plannerUsername = `planner.integration.${Date.now()}`;
    createdUsernames.push(plannerUsername);
    await agent
      .post("/api/v1/admin/users")
      .set("X-CSRF-Token", csrfToken)
      .send({
        username: plannerUsername,
        displayName: "集成测试规划老师",
        password: "IntegrationPassword!2026",
        roleCodes: ["PLANNER"],
      })
      .expect(201);
    const peopleAfter = await agent.get("/api/v1/students/responsible-person-options").expect(200);
    const planner = peopleAfter.body.data.planners.find(
      (person: { displayName: string }) => person.displayName === "集成测试规划老师",
    ) as { id: string; displayName: string };
    expect(planner).toBeDefined();

    const invalidButler = await agent
      .put(`/api/v1/students/${student.id}/default-butler`)
      .set("X-CSRF-Token", csrfToken)
      .send({ userId: planner.id, reason: "错误角色验证", version: 1 })
      .expect(400);
    expect(invalidButler.body.error.code).toBe("RESPONSIBLE_PERSON_INVALID");

    const assignedButler = await agent
      .put(`/api/v1/students/${student.id}/default-butler`)
      .set("X-CSRF-Token", csrfToken)
      .send({ userId: butler.id, reason: "建立日常服务负责人关系", version: 1 })
      .expect(200);
    expect(assignedButler.body.data).toMatchObject({
      defaultButler: { id: butler.id },
      version: 2,
    });

    const assignedPlanner = await agent
      .put(`/api/v1/students/${student.id}/planner`)
      .set("X-CSRF-Token", csrfToken)
      .send({ userId: planner.id, reason: "安排升学规划支持", version: 2 })
      .expect(200);
    expect(assignedPlanner.body.data).toMatchObject({
      planner: { id: planner.id },
      version: 3,
    });

    const stale = await agent
      .patch(`/api/v1/students/${student.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "过期版本不应覆盖", version: 1 })
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: "STUDENT_VERSION_CONFLICT",
      details: { currentVersion: 3 },
    });

    const updated = await agent
      .patch(`/api/v1/students/${student.id}`)
      .set("X-CSRF-Token", csrfToken)
      .send({
        name: "黄翰",
        phone: "+852 6123 4567",
        email: "hon.wong@example.com",
        version: 3,
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      phone: "+852 6123 4567",
      email: "hon.wong@example.com",
      version: 4,
    });

    const detail = await agent.get(`/api/v1/students/${student.id}`).expect(200);
    expect(detail.body.data).toMatchObject({
      sopVersion: null,
      taskSummary: { total: 0, unassigned: 0 },
    });
    expect(detail.body.data.responsibilityHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          responsibilityType: "DEFAULT_BUTLER",
          previousUser: null,
          newUser: { id: butler.id, displayName: butler.displayName },
          reason: "建立日常服务负责人关系",
        }),
        expect.objectContaining({
          responsibilityType: "PLANNER",
          previousUser: null,
          newUser: { id: planner.id, displayName: planner.displayName },
          reason: "安排升学规划支持",
        }),
      ]),
    );

    await expect(
      prisma.student.create({
        data: {
          studentNo: student.studentNo,
          name: "重复编号应被拒绝",
          createdById: detail.body.data.createdBy.id as string,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    const audits = await agent
      .get("/api/v1/admin/audit-logs")
      .query({ objectType: "student", pageSize: 100 })
      .expect(200);
    const actions = audits.body.data.items
      .filter((event: { objectId: string }) => event.objectId === student.id)
      .map((event: { action: string }) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "STUDENT_CREATED",
        "STUDENT_DEFAULT_BUTLER_CHANGED",
        "STUDENT_PLANNER_CHANGED",
        "STUDENT_UPDATED",
        "STUDENT_UPDATE_CONFLICT",
      ]),
    );
  });

  it("rejects a butler from student administration APIs", async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post("/api/v1/auth/login")
      .send({
        username: process.env.SEED_BUTLER_USERNAME ?? "butler",
        password: process.env.SEED_BUTLER_PASSWORD ?? "ButlerPassword!2026",
      })
      .expect(201);

    const response = await agent.get("/api/v1/students").expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });
});
