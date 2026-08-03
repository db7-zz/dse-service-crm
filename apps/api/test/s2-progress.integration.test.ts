import type { PrismaClient } from "@dse/database";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PRISMA } from "../src/database/database.module.js";
import { assertSafeTestDatabaseUrl } from "./test-database.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("S2 student service progress", () => {
  let app: INestApplication;

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(testDatabaseUrl!);
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = testDatabaseUrl!;
    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import("../src/app.module.js"),
      import("../src/bootstrap.js"),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
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

  async function finishTask(
    session: Awaited<ReturnType<typeof login>>,
    task: { id: string; version: number },
  ) {
    const started = await session.agent
      .post(`/api/v1/tasks/${task.id}/start`)
      .set("X-CSRF-Token", session.csrfToken)
      .set("Idempotency-Key", `s2-start-${task.id}-${Date.now()}`)
      .send({ version: task.version })
      .expect(201);
    return session.agent
      .post(`/api/v1/tasks/${task.id}/complete`)
      .set("X-CSRF-Token", session.csrfToken)
      .set("Idempotency-Key", `s2-complete-${task.id}-${Date.now()}`)
      .send({ version: started.body.data.version, completionNote: "S2 集成测试完成" })
      .expect(201);
  }

  it("supports row scope, legacy work and continuous stage advancement", async () => {
    const admin = await login(
      process.env.SEED_ADMIN_USERNAME ?? "admin",
      process.env.SEED_ADMIN_PASSWORD ?? "AdminPassword!2026",
    );
    const butler = await login(
      process.env.SEED_BUTLER_USERNAME ?? "butler",
      process.env.SEED_BUTLER_PASSWORD ?? "ButlerPassword!2026",
    );
    const people = await admin.agent.get("/api/v1/students/responsible-person-options").expect(200);
    const butlerId = people.body.data.butlers[0]?.id as string | undefined;
    expect(butlerId).toBeDefined();
    if (!butlerId) throw new Error("S2 test requires a seeded butler");

    const studentResult = await admin.agent
      .post("/api/v1/students")
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ name: `S2进度联调-${Date.now()}`, defaultButlerId: butlerId })
      .expect(201);
    const student = studentResult.body.data as { id: string; version: number };
    const activation = await admin.agent
      .post(`/api/v1/students/${student.id}/service-activation`)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ version: student.version })
      .expect(201);
    expect(activation.body.data).toMatchObject({
      completedStageCount: 0,
      progressVersion: 1,
      currentStage: { sequenceNo: 1 },
    });

    const mine = await butler.agent.get("/api/v1/my/students").expect(200);
    expect(mine.body.data.items.map((item: { id: string }) => item.id)).toContain(student.id);
    const detail = await admin.agent.get(`/api/v1/students/${student.id}`).expect(200);
    expect(detail.body.data.progress).toMatchObject({
      completedStageCount: 0,
      currentStage: { sequenceNo: 1 },
    });
    expect(detail.body.data.stages.map((stage: { status: string }) => stage.status)).toEqual([
      "IN_PROGRESS",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
    ]);

    const firstStage = detail.body.data.stages[0] as {
      id: string;
      version: number;
      tasks: Array<{ id: string; version: number; isBlocking: boolean }>;
    };
    const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    dueAt.setUTCSeconds(0, 0);
    const manualTaskKey = `s2-manual-${Date.now()}`;
    const manualTask = await admin.agent
      .post(`/api/v1/students/${student.id}/manual-tasks`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", manualTaskKey)
      .send({
        stageInstanceId: firstStage.id,
        title: "保留为前序遗留的非阻塞跟进",
        currentDueAt: dueAt.toISOString(),
        ownerId: butlerId,
        isBlocking: false,
        stageVersion: firstStage.version,
      })
      .expect(201);
    const repeatedManualTask = await admin.agent
      .post(`/api/v1/students/${student.id}/manual-tasks`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", manualTaskKey)
      .send({
        stageInstanceId: firstStage.id,
        title: "保留为前序遗留的非阻塞跟进",
        currentDueAt: dueAt.toISOString(),
        ownerId: butlerId,
        isBlocking: false,
        stageVersion: firstStage.version,
      })
      .expect(201);
    expect(repeatedManualTask.body.data.id).toBe(manualTask.body.data.id);

    const stages = detail.body.data.stages as Array<{
      tasks: Array<{ id: string; version: number; isBlocking: boolean }>;
    }>;
    const earlyStageTwo = stages[1]!.tasks.find((task) => task.isBlocking)!;
    const earlyStageThree = stages[2]!.tasks.find((task) => task.isBlocking)!;
    const earlyTwoResult = await finishTask(butler, earlyStageTwo);
    const earlyThreeResult = await finishTask(butler, earlyStageThree);
    expect(earlyTwoResult.body.data.stageChanged).toBe(false);
    expect(earlyThreeResult.body.data.stageChanged).toBe(false);

    const firstBlocking = firstStage.tasks.find((task) => task.isBlocking)!;
    const advanced = await finishTask(butler, firstBlocking);
    expect(advanced.body.data).toMatchObject({
      stageChanged: true,
      completedStageCount: 3,
      currentStage: { sequenceNo: 4 },
    });
    expect(advanced.body.data.advancedStages).toHaveLength(3);

    const progressed = await admin.agent.get(`/api/v1/students/${student.id}`).expect(200);
    expect(progressed.body.data.progress).toMatchObject({
      completedStageCount: 3,
      currentStage: { sequenceNo: 4 },
      legacyTaskCount: 1,
    });
    const completedFirstStage = progressed.body.data.stages[0] as {
      id: string;
      version: number;
    };
    const rejected = await admin.agent
      .post(`/api/v1/students/${student.id}/manual-tasks`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", `s2-block-completed-${Date.now()}`)
      .send({
        stageInstanceId: completedFirstStage.id,
        title: "不应创建的阻塞任务",
        currentDueAt: dueAt.toISOString(),
        isBlocking: true,
        stageVersion: completedFirstStage.version,
      })
      .expect(409);
    expect(rejected.body.error.code).toBe("STAGE_ALREADY_COMPLETED");

    const prisma = app.get<PrismaClient>(PRISMA);
    await prisma.studentServiceActivation.update({
      where: { studentId: student.id },
      data: {
        calculationStatus: "ERROR",
        calculationErrorCode: "S2_INTEGRATION_RECALCULATION",
      },
    });
    const recalculationKey = `s2-recalculation-${Date.now()}`;
    const recalculated = await admin.agent
      .post(`/api/v1/students/${student.id}/service-progress/recalculate`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", recalculationKey)
      .expect(201);
    const repeatedRecalculation = await admin.agent
      .post(`/api/v1/students/${student.id}/service-progress/recalculate`)
      .set("X-CSRF-Token", admin.csrfToken)
      .set("Idempotency-Key", recalculationKey)
      .expect(201);
    expect(repeatedRecalculation.body.data.calculationRunId).toBe(
      recalculated.body.data.calculationRunId,
    );

    const removedButler = await admin.agent
      .put(`/api/v1/students/${student.id}/default-butler`)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        userId: null,
        reason: "S2集成测试验证默认管家权限立即转移",
        version: progressed.body.data.version,
      })
      .expect(200);
    await butler.agent.get(`/api/v1/my/students/${student.id}`).expect(403);
    await admin.agent
      .put(`/api/v1/students/${student.id}/default-butler`)
      .set("X-CSRF-Token", admin.csrfToken)
      .send({
        userId: butlerId,
        reason: "S2集成测试恢复默认管家",
        version: removedButler.body.data.version,
      })
      .expect(200);
    await butler.agent.get(`/api/v1/my/students/${student.id}`).expect(200);

    const unrelated = await admin.agent
      .post("/api/v1/students")
      .set("X-CSRF-Token", admin.csrfToken)
      .send({ name: `S2权限隔离-${Date.now()}` })
      .expect(201);
    await butler.agent.get(`/api/v1/my/students/${unrelated.body.data.id}`).expect(403);
  });
});
