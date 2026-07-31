import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { PrismaClient } from "@dse/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S1 SOP, activation, task execution and supervision", () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
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
    await app?.close();
  });

  async function login(username: string, password: string) {
    const agent = request.agent(app.getHttpServer());
    await agent.post("/api/v1/auth/login").send({ username, password }).expect(201);
    const csrf = await agent.get("/api/v1/auth/csrf").expect(200);
    return { agent, csrfToken: csrf.body.data.csrfToken as string };
  }

  it("completes the vertical S1 workflow with snapshots, idempotency and alerts", async () => {
    const admin = await login(
      process.env.SEED_ADMIN_USERNAME ?? "admin",
      process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
    );
    const versions = await admin.agent.get("/api/v1/sop-versions").expect(200);
    let published = versions.body.data.items.find(
      (version: { status: string }) => version.status === "PUBLISHED",
    ) as { id: string; version: number } | undefined;
    if (!published) {
      const draft = versions.body.data.items.find(
        (version: { status: string }) => version.status === "DRAFT",
      ) as { id: string; version: number };
      expect(draft).toBeDefined();
      const validation = await admin.agent
        .post(`/api/v1/sop-versions/${draft.id}/validate`)
        .set("X-CSRF-Token", admin.csrfToken)
        .expect(201);
      expect(validation.body.data.valid).toBe(true);
      const result = await admin.agent
        .post(`/api/v1/sop-versions/${draft.id}/publish`)
        .set("X-CSRF-Token", admin.csrfToken)
        .send({ version: draft.version })
        .expect(201);
      published = result.body.data;
    }
    expect(published).toBeDefined();

    const created = await admin.agent
      .post("/api/v1/students")
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ name: `S1纵向联调-${Date.now()}` })
      .expect(201);
    const student = created.body.data as { id: string; version: number };
    const activation = await admin.agent
      .post(`/api/v1/students/${student.id}/service-activation`)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ version: student.version })
      .expect(201);
    expect(activation.body.data).toMatchObject({
      serviceStatus: "ENABLED",
      stageCount: 8,
      taskCount: 8,
      assignedTaskCount: 0,
      unassignedTaskCount: 8,
    });

    const detail = await admin.agent.get(`/api/v1/students/${student.id}`).expect(200);
    expect(detail.body.data.stages).toHaveLength(8);
    expect(detail.body.data.taskSummary).toMatchObject({
      total: 8,
      unassigned: 8,
    });
    const tasks = detail.body.data.stages.flatMap(
      (stage: { tasks: Array<{ id: string; version: number }> }) => stage.tasks,
    ) as Array<{ id: string; version: number }>;
    const people = await admin.agent.get("/api/v1/students/responsible-person-options").expect(200);
    const seededButler = await prisma.user.findUnique({
      where: { username: process.env.SEED_BUTLER_USERNAME ?? "butler" },
      select: { id: true },
    });
    const butler = people.body.data.butlers.find(
      (candidate: { id: string }) => candidate.id === seededButler?.id,
    ) as { id: string } | undefined;
    expect(butler).toBeDefined();
    if (!butler) {
      throw new Error("Seeded Butler is missing from responsible person options");
    }

    const bulkKey = `bulk-assign-${Date.now()}`;
    const bulkBody = {
      butlerId: butler.id,
      reason: "S1 集成测试批量分配",
      tasks: tasks.slice(0, 2).map((task) => ({
        taskId: task.id,
        version: task.version,
      })),
    };
    const bulkAssigned = await admin.agent
      .post(`/api/v1/students/${student.id}/assign-unassigned-tasks`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", bulkKey)
      .send(bulkBody)
      .expect(201);
    const bulkRepeated = await admin.agent
      .post(`/api/v1/students/${student.id}/assign-unassigned-tasks`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", bulkKey)
      .send(bulkBody)
      .expect(201);
    expect(bulkRepeated.body.data).toEqual(bulkAssigned.body.data);

    const butlerSession = await login(
      process.env.SEED_BUTLER_USERNAME ?? "butler",
      process.env.SEED_BUTLER_PASSWORD ?? "ButlerPassword!2026",
    );
    const mine = await butlerSession.agent
      .get("/api/v1/my/tasks")
      .query({ studentId: student.id, pageSize: 100 })
      .expect(200);
    expect(mine.body.data.items.map((task: { id: string }) => task.id)).toContain(tasks[0]!.id);
    const cannotEscapeOwnership = await butlerSession.agent
      .get("/api/v1/my/tasks")
      .query({ studentId: student.id, unassigned: true, pageSize: 100 })
      .expect(200);
    expect(
      cannotEscapeOwnership.body.data.items.every(
        (task: { owner: { id: string } | null }) => task.owner?.id === butler.id,
      ),
    ).toBe(true);
    const assignedTask = mine.body.data.items.find(
      (task: { id: string }) => task.id === tasks[0]!.id,
    ) as { id: string; version: number; currentDueAt: string };
    const extension = await butlerSession.agent
      .post(`/api/v1/tasks/${assignedTask.id}/extensions`)
      .set("X-CSRF-Token", butlerSession.csrfToken)
      .set("Idempotency-Key", `extension-${Date.now()}`)
      .send({
        version: assignedTask.version,
        reason: "需要等待学生补充资料",
        expectedFinishAt: new Date(
          new Date(assignedTask.currentDueAt).getTime() + 60 * 60 * 1000,
        ).toISOString(),
      })
      .expect(201);
    expect(extension.body.data.latestExtension.reason).toBe("需要等待学生补充资料");
    expect(extension.body.data.extensionReports).toHaveLength(1);

    const startKey = `start-${Date.now()}`;
    const started = await butlerSession.agent
      .post(`/api/v1/tasks/${assignedTask.id}/start`)
      .set("X-CSRF-Token", butlerSession.csrfToken)
      .set("Idempotency-Key", startKey)
      .send({ version: extension.body.data.version })
      .expect(201);
    const repeated = await butlerSession.agent
      .post(`/api/v1/tasks/${assignedTask.id}/start`)
      .set("X-CSRF-Token", butlerSession.csrfToken)
      .set("Idempotency-Key", startKey)
      .send({ version: extension.body.data.version })
      .expect(201);
    expect(repeated.body.data.version).toBe(started.body.data.version);

    const progress = await butlerSession.agent
      .post(`/api/v1/tasks/${assignedTask.id}/progress`)
      .set("X-CSRF-Token", butlerSession.csrfToken)
      .set("Idempotency-Key", `progress-${Date.now()}`)
      .send({
        version: started.body.data.version,
        progressNote: "完成首轮资料核对",
        progressPercent: 60,
      })
      .expect(201);
    const completed = await butlerSession.agent
      .post(`/api/v1/tasks/${assignedTask.id}/complete`)
      .set("X-CSRF-Token", butlerSession.csrfToken)
      .set("Idempotency-Key", `complete-${Date.now()}`)
      .send({
        version: progress.body.data.version,
        completionNote: "已按完成标准交付",
      })
      .expect(201);
    expect(completed.body.data).toMatchObject({
      status: "COMPLETED",
      progressPercent: 100,
    });

    const supervisedTaskId = tasks[1]!.id;
    await prisma.taskInstance.update({
      where: { id: supervisedTaskId },
      data: { currentDueAt: new Date(Date.now() - 60_000) },
    });
    await admin.agent
      .get("/api/v1/admin/task-supervision/tasks")
      .query({ studentId: student.id })
      .expect(200);
    const alerts = await admin.agent
      .get("/api/v1/admin/overdue-alerts")
      .query({ status: "OPEN" })
      .expect(200);
    const alert = alerts.body.data.items.find(
      (item: { task: { id: string } }) => item.task.id === supervisedTaskId,
    ) as { id: string; task: { version: number } };
    expect(alert).toBeDefined();
    await admin.agent
      .post(`/api/v1/admin/overdue-alerts/${alert.id}/handle`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", `handle-${Date.now()}`)
      .send({ note: "管理员已跟进" })
      .expect(201);
    const rescheduled = await admin.agent
      .post(`/api/v1/admin/tasks/${supervisedTaskId}/reschedule`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", `reschedule-${Date.now()}`)
      .send({
        version: alert.task.version,
        newDueAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        reason: "根据延期报备调整截止时间",
      })
      .expect(201);
    expect(
      rescheduled.body.data.overdueAlerts.find(
        (item: { id: string; status: string }) => item.id === alert.id,
      ).status,
    ).toBe("RESOLVED");

    await prisma.taskInstance.update({
      where: { id: supervisedTaskId },
      data: { currentDueAt: new Date(Date.now() - 60_000) },
    });
    const secondEpisodeResponse = await admin.agent
      .get("/api/v1/admin/overdue-alerts")
      .query({ status: "OPEN" })
      .expect(200);
    const secondEpisode = secondEpisodeResponse.body.data.items.find(
      (item: { task: { id: string } }) => item.task.id === supervisedTaskId,
    ) as { id: string; episode: number };
    expect(secondEpisode.episode).toBe(2);
    const openAlertTasks = await admin.agent
      .get("/api/v1/admin/task-supervision/tasks")
      .query({ studentId: student.id, openAlert: true })
      .expect(200);
    expect(openAlertTasks.body.data.items.map((task: { id: string }) => task.id)).toContain(
      supervisedTaskId,
    );

    const canceled = await admin.agent
      .post(`/api/v1/admin/tasks/${supervisedTaskId}/cancel`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", `cancel-${Date.now()}`)
      .send({
        version: rescheduled.body.data.version,
        reason: "完成管理员取消与提醒解除联调",
      })
      .expect(201);
    expect(canceled.body.data.status).toBe("CANCELED");
    expect(
      canceled.body.data.overdueAlerts.find(
        (item: { id: string; status: string }) => item.id === secondEpisode.id,
      ).status,
    ).toBe("RESOLVED");
  });
});
