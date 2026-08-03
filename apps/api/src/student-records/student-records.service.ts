import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type {
  UpdateStudentRecordDto,
  UpdateStudentRiskDto,
  UpdateStudentServiceStatusDto,
} from "./student-records.dto.js";

const RECORD_INCLUDE = {
  defaultButler: { select: { id: true, displayName: true } },
  planner: { select: { id: true, displayName: true } },
  scores: { orderBy: [{ scoreType: "asc" as const }, { subjectName: "asc" as const }] },
  targets: { orderBy: { updatedAt: "desc" as const } },
  serviceActivation: {
    select: {
      completedStageCount: true,
      currentStage: {
        select: {
          id: true,
          stageCodeSnapshot: true,
          nameSnapshot: true,
          sequenceNoSnapshot: true,
          status: true,
        },
      },
    },
  },
  materialItems: {
    select: { status: true, materialType: { select: { isCore: true } } },
  },
  applications: {
    select: { id: true, channel: true, institutionName: true, programName: true, status: true },
    orderBy: { updatedAt: "desc" as const },
  },
} satisfies Prisma.StudentInclude;

@Injectable()
export class StudentRecordsService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
  ) {}

  public async detail(studentId: string, request: RequestContext) {
    await this.access.assertInternalAccess(studentId, request);
    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: RECORD_INCLUDE,
    });
    return this.serialize(student);
  }

  public async update(studentId: string, body: UpdateStudentRecordDto, request: RequestContext) {
    await this.access.assertInternalAccess(studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.student.findUnique({ where: { id: studentId } });
      if (!existing) {
        throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
      }
      if (existing.version !== body.version) throw this.versionConflict(existing.version);
      const result = await transaction.student.updateMany({
        where: { id: studentId, version: body.version },
        data: {
          ...(body.englishName !== undefined
            ? { englishName: this.optionalText(body.englishName) }
            : {}),
          ...(body.school !== undefined ? { school: this.optionalText(body.school) } : {}),
          ...(body.grade !== undefined ? { grade: this.optionalText(body.grade) } : {}),
          ...(body.cohortYear !== undefined ? { cohortYear: body.cohortYear } : {}),
          ...(body.nextMilestone !== undefined
            ? { nextMilestone: this.optionalText(body.nextMilestone) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await transaction.student.findUniqueOrThrow({ where: { id: studentId } });
        throw this.versionConflict(current.version);
      }
      if (body.scores) {
        await transaction.studentScore.deleteMany({ where: { studentId } });
        if (body.scores.length > 0) {
          await transaction.studentScore.createMany({
            data: body.scores.map((score) => ({
              studentId,
              subjectName: score.subjectName.trim(),
              scoreType: score.scoreType,
              scoreValue: score.scoreValue.trim(),
              updatedById: actor.id,
            })),
          });
        }
      }
      if (body.targets) {
        await transaction.studentTarget.deleteMany({ where: { studentId } });
        if (body.targets.length > 0) {
          await transaction.studentTarget.createMany({
            data: body.targets.map((target) => ({
              studentId,
              institutionName: target.institutionName.trim(),
              programName: this.optionalText(target.programName),
              targetLevel: target.targetLevel,
              updatedById: actor.id,
            })),
          });
        }
      }
      await transaction.auditLog.create({
        data: this.audit(request, studentId, "STUDENT_RECORD_UPDATED", body.reason, {
          updatedFields: Object.keys(body).filter((key) => key !== "reason"),
          previousVersion: body.version,
          nextVersion: body.version + 1,
        }),
      });
      const updated = await transaction.student.findUniqueOrThrow({
        where: { id: studentId },
        include: RECORD_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async updateRisk(studentId: string, body: UpdateStudentRiskDto, request: RequestContext) {
    await this.access.assertInternalAccess(studentId, request);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.student.findUnique({ where: { id: studentId } });
      if (!existing) {
        throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
      }
      if (existing.version !== body.version) throw this.versionConflict(existing.version);
      const result = await transaction.student.updateMany({
        where: { id: studentId, version: body.version },
        data: {
          riskLevel: body.riskLevel,
          riskNote: this.optionalText(body.riskNote),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await transaction.student.findUniqueOrThrow({ where: { id: studentId } });
        throw this.versionConflict(current.version);
      }
      const updated = await transaction.student.findUniqueOrThrow({
        where: { id: studentId },
        include: RECORD_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.audit(request, studentId, "STUDENT_RISK_UPDATED", body.riskNote ?? undefined, {
          before: { riskLevel: existing.riskLevel, riskNote: existing.riskNote },
          after: { riskLevel: updated.riskLevel, riskNote: updated.riskNote },
        }),
      });
      return this.serialize(updated);
    });
  }

  public async updateServiceStatus(
    studentId: string,
    body: UpdateStudentServiceStatusDto,
    request: RequestContext,
  ) {
    await this.access.assertInternalAccess(studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.student.findUnique({ where: { id: studentId } });
      if (!existing) {
        throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
      }
      if (existing.version !== body.version) throw this.versionConflict(existing.version);
      if (body.status === "TERMINATED" && body.unfinishedTaskAction === "CANCEL") {
        const now = new Date();
        const unfinishedTasks = await transaction.taskInstance.findMany({
          where: { studentId, status: { in: ["TODO", "IN_PROGRESS"] } },
          select: { id: true, status: true, version: true },
        });
        await transaction.taskInstance.updateMany({
          where: { studentId, status: { in: ["TODO", "IN_PROGRESS"] } },
          data: {
            status: "CANCELED",
            canceledAt: now,
            canceledById: actor.id,
            cancelReason: body.reason.trim(),
            version: { increment: 1 },
          },
        });
        if (unfinishedTasks.length > 0) {
          await transaction.taskTimelineEvent.createMany({
            data: unfinishedTasks.map((task) => ({
              taskId: task.id,
              eventType: "CANCELED",
              actorId: actor.id,
              actorRole: actor.roles[0] ?? null,
              summary: "学生服务终止，系统按所选处理方式取消未完成任务",
              reason: body.reason.trim(),
              beforeData: { status: task.status, version: task.version },
              afterData: { status: "CANCELED", version: task.version + 1 },
            })),
          });
          await transaction.overdueAlert.updateMany({
            where: { taskId: { in: unfinishedTasks.map((task) => task.id) }, status: "OPEN" },
            data: {
              status: "RESOLVED",
              handledById: actor.id,
              handledAt: now,
              resolvedAt: now,
              resolvedReason: "STUDENT_SERVICE_TERMINATED",
            },
          });
        }
      }
      const updated = await transaction.student.update({
        where: { id: studentId },
        data: { serviceStatus: body.status, version: { increment: 1 } },
        include: RECORD_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.audit(request, studentId, "STUDENT_SERVICE_STATUS_CHANGED", body.reason, {
          before: existing.serviceStatus,
          after: body.status,
          unfinishedTaskAction: body.unfinishedTaskAction,
        }),
      });
      return this.serialize(updated);
    });
  }

  private serialize(student: Prisma.StudentGetPayload<{ include: typeof RECORD_INCLUDE }>) {
    const missingCoreMaterialCount = student.materialItems.filter(
      (item) => item.materialType.isCore && !["APPROVED", "NOT_APPLICABLE"].includes(item.status),
    ).length;
    return {
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      englishName: student.englishName,
      school: student.school,
      grade: student.grade,
      cohortYear: student.cohortYear,
      phone: student.phone,
      email: student.email,
      serviceStatus: student.serviceStatus,
      nextMilestone: student.nextMilestone,
      riskLevel: student.riskLevel,
      riskNote: student.riskNote,
      defaultButler: student.defaultButler,
      planner: student.planner,
      version: student.version,
      scores: student.scores.map((score) => ({
        id: score.id,
        subjectName: score.subjectName,
        scoreType: score.scoreType,
        scoreValue: score.scoreValue,
        updatedAt: score.updatedAt.toISOString(),
      })),
      targets: student.targets.map((target) => ({
        id: target.id,
        institutionName: target.institutionName,
        programName: target.programName,
        targetLevel: target.targetLevel,
        status: target.status,
        updatedAt: target.updatedAt.toISOString(),
      })),
      progress: student.serviceActivation
        ? {
            completedStageCount: student.serviceActivation.completedStageCount,
            currentStage: student.serviceActivation.currentStage
              ? {
                  id: student.serviceActivation.currentStage.id,
                  code: student.serviceActivation.currentStage.stageCodeSnapshot,
                  name: student.serviceActivation.currentStage.nameSnapshot,
                  sequenceNo: student.serviceActivation.currentStage.sequenceNoSnapshot,
                  status: student.serviceActivation.currentStage.status,
                }
              : null,
          }
        : null,
      missingCoreMaterialCount,
      applications: student.applications,
      createdAt: student.createdAt.toISOString(),
      updatedAt: student.updatedAt.toISOString(),
    };
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.STUDENT_VERSION_CONFLICT,
      "学生资料已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private audit(
    request: RequestContext,
    studentId: string,
    action: string,
    reason: string | undefined,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: "student_record",
      objectId: studentId,
      action,
      afterData,
      reason,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
