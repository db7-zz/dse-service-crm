import { config as loadEnvironment } from "dotenv";
import { createPrismaClient } from "../src/index.js";

loadEnvironment({ path: new URL("../../.env", import.meta.url), quiet: true });

const mode = process.argv.includes("--verify") ? "verify" : "preview";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const prisma = createPrismaClient(databaseUrl);
try {
  const [
    sopVersionCount,
    taskTemplateCount,
    studentCount,
    stageCount,
    taskCount,
    activations,
    mislinkedTasks,
  ] = await Promise.all([
    prisma.sopVersion.count(),
    prisma.sopTaskTemplate.count(),
    prisma.student.count(),
    prisma.stageInstance.count(),
    prisma.taskInstance.count(),
    prisma.studentServiceActivation.findMany({
      select: {
        id: true,
        studentId: true,
        stages: {
          orderBy: { sequenceNoSnapshot: "asc" },
          select: {
            id: true,
            sequenceNoSnapshot: true,
            tasks: { select: { status: true } },
          },
        },
      },
    }),
    prisma.$queryRaw<Array<{ studentId: string; taskId: string }>>`
        SELECT task."student_id" AS "studentId", task."id" AS "taskId"
        FROM "task_instances" task
        JOIN "stage_instances" stage ON stage."id" = task."stage_instance_id"
        WHERE stage."service_activation_id" <> task."service_activation_id"
          OR stage."student_id" <> task."student_id"
      `,
  ]);

  let expectedCompletedStageCount = 0;
  const anomalies: Array<{ studentId: string; reason: string }> = [];
  for (const activation of activations) {
    if (
      activation.stages.length !== 8 ||
      activation.stages.some((stage, index) => stage.sequenceNoSnapshot !== index + 1)
    ) {
      anomalies.push({ studentId: activation.studentId, reason: "STAGE_SEQUENCE_INVALID" });
      continue;
    }
    for (const stage of activation.stages) {
      if (stage.tasks.length === 0) {
        anomalies.push({ studentId: activation.studentId, reason: "STAGE_TASK_MISSING" });
        break;
      }
      const allTerminal = stage.tasks.every(
        (task) => task.status === "COMPLETED" || task.status === "CANCELED",
      );
      if (!allTerminal) break;
      expectedCompletedStageCount += 1;
    }
  }
  for (const task of mislinkedTasks) {
    if (!anomalies.some((anomaly) => anomaly.studentId === task.studentId)) {
      anomalies.push({ studentId: task.studentId, reason: "TASK_STAGE_RELATION_INVALID" });
    }
  }

  const result: Record<string, unknown> = {
    mode,
    migration: "20260803000100_s2_service_progress",
    sopVersionCount,
    taskTemplateCount,
    enabledStudentCount: activations.length,
    studentCount,
    stageCount,
    taskCount,
    expectedCompletedStageCount,
    anomalyCount: anomalies.length,
    anomalies,
    mislinkedTaskCount: mislinkedTasks.length,
  };

  if (mode === "verify") {
    const [statusRows, summaryMismatchRows, calculationStatusRows, failedMigrationRuns] =
      await Promise.all([
        prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT "status"::text AS "status", COUNT(*)::bigint AS "count"
        FROM "stage_instances"
        GROUP BY "status"
        ORDER BY "status"
      `,
        prisma.$queryRaw<Array<{ activationId: string }>>`
        SELECT activation."id" AS "activationId"
        FROM "student_service_activations" activation
        LEFT JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE stage."status" = 'COMPLETED')::integer AS completed_count,
            COUNT(*) FILTER (WHERE stage."status" = 'IN_PROGRESS')::integer AS current_count,
            (MIN(stage."id"::text) FILTER (WHERE stage."status" = 'IN_PROGRESS'))::uuid AS current_id
          FROM "stage_instances" stage
          WHERE stage."service_activation_id" = activation."id"
        ) facts ON TRUE
        WHERE activation."completed_stage_count" <> facts.completed_count
          OR facts.current_count > 1
          OR activation."current_stage_instance_id" IS DISTINCT FROM facts.current_id
      `,
        prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
        SELECT "calculation_status"::text AS "status", COUNT(*)::bigint AS "count"
        FROM "student_service_activations"
        GROUP BY "calculation_status"
        ORDER BY "calculation_status"
      `,
        prisma.serviceProgressCalculationRun.count({
          where: { type: "MIGRATION", status: "FAILED" },
        }),
      ]);
    result.stageStatuses = Object.fromEntries(
      statusRows.map((row) => [row.status, Number(row.count)]),
    );
    result.calculationStatuses = Object.fromEntries(
      calculationStatusRows.map((row) => [row.status, Number(row.count)]),
    );
    result.failedMigrationRunCount = failedMigrationRuns;
    result.summaryMismatchCount = summaryMismatchRows.length;
    result.summaryMismatchActivationIds = summaryMismatchRows.map((row) => row.activationId);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await prisma.$disconnect();
}
