import { createHash } from "node:crypto";
import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type { ActivateStudentServiceDto, BulkAssignUnassignedTasksDto } from "./students.dto.js";

const ACTIVE_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;

@Injectable()
export class StudentWorkflowService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async activate(
    studentId: string,
    body: ActivateStudentServiceDto,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      const student = await transaction.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          studentNo: true,
          name: true,
          serviceStatus: true,
          defaultButlerId: true,
          version: true,
        },
      });
      if (!student) {
        throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
      }
      if (student.serviceStatus === "ENABLED") {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SERVICE_ALREADY_ENABLED,
          "该学生已经启用服务，不能重复生成任务",
        );
      }
      if (student.version !== body.version) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.STUDENT_VERSION_CONFLICT,
          "学生资料已被其他操作更新，请刷新后重试",
          { currentVersion: student.version },
        );
      }

      const publishedVersions = await transaction.sopVersion.findMany({
        where: { status: "PUBLISHED" },
        include: {
          stages: {
            orderBy: { sequenceNo: "asc" },
            include: { tasks: { orderBy: { sequenceNo: "asc" } } },
          },
        },
      });
      if (publishedVersions.length !== 1) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SERVICE_ACTIVATION_UNAVAILABLE,
          publishedVersions.length === 0
            ? "当前没有已发布的 SOP，暂时无法启用服务"
            : "当前已发布 SOP 状态异常，请先处理版本冲突",
          { publishedVersionCount: publishedVersions.length },
        );
      }
      const sop = publishedVersions[0]!;
      if (
        sop.stages.length !== 8 ||
        sop.stages.some(
          (stage) =>
            stage.tasks.length === 0 ||
            stage.tasks.some(
              (task) =>
                !Number.isInteger(task.completionWindowHours) || task.completionWindowHours < 1,
            ),
        )
      ) {
        throw new ApiException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          ErrorCode.SERVICE_ACTIVATION_UNAVAILABLE,
          "已发布 SOP 不满足八阶段和任务时限规则，无法启用服务",
        );
      }

      const enabledAt = new Date();
      enabledAt.setUTCSeconds(0, 0);
      const lock = await transaction.student.updateMany({
        where: {
          id: studentId,
          version: body.version,
          serviceStatus: "NOT_ENABLED",
        },
        data: {
          serviceStatus: "ENABLED",
          version: { increment: 1 },
        },
      });
      if (lock.count !== 1) {
        const current = await transaction.student.findUniqueOrThrow({
          where: { id: studentId },
          select: { serviceStatus: true, version: true },
        });
        throw new ApiException(
          HttpStatus.CONFLICT,
          current.serviceStatus === "ENABLED"
            ? ErrorCode.SERVICE_ALREADY_ENABLED
            : ErrorCode.STUDENT_VERSION_CONFLICT,
          current.serviceStatus === "ENABLED"
            ? "该学生已经启用服务，不能重复生成任务"
            : "学生资料已被其他操作更新，请刷新后重试",
          { currentVersion: current.version },
        );
      }

      const activation = await transaction.studentServiceActivation.create({
        data: {
          studentId,
          sopVersionId: sop.id,
          enabledById: actor.id,
          enabledAt,
        },
      });

      let taskCount = 0;
      for (const stage of sop.stages) {
        const stageInstance = await transaction.stageInstance.create({
          data: {
            studentId,
            serviceActivationId: activation.id,
            sopVersionId: sop.id,
            stageTemplateId: stage.id,
            stageCodeSnapshot: stage.stageCode,
            nameSnapshot: stage.name,
            sequenceNoSnapshot: stage.sequenceNo,
            descriptionSnapshot: stage.description,
          },
        });
        for (const taskTemplate of stage.tasks) {
          const dueAt = this.calculateDueAt(enabledAt, taskTemplate.completionWindowHours);
          const task = await transaction.taskInstance.create({
            data: {
              studentId,
              serviceActivationId: activation.id,
              stageInstanceId: stageInstance.id,
              taskTemplateId: taskTemplate.id,
              sopVersionId: sop.id,
              titleSnapshot: taskTemplate.name,
              descriptionSnapshot: taskTemplate.description,
              completionCriteriaSnapshot: taskTemplate.completionCriteria,
              completionWindowHoursSnapshot: taskTemplate.completionWindowHours,
              ownerId: student.defaultButlerId,
              originalDueAt: dueAt,
              currentDueAt: dueAt,
            },
          });
          await transaction.taskTimelineEvent.createMany({
            data: [
              {
                taskId: task.id,
                eventType: "CREATED",
                actorId: actor.id,
                actorRole: actor.roles[0] ?? null,
                summary: "启用服务时生成任务",
                afterData: {
                  status: "TODO",
                  dueAt: dueAt.toISOString(),
                  sopVersionNo: sop.versionNo,
                },
              },
              ...(student.defaultButlerId
                ? [
                    {
                      taskId: task.id,
                      eventType: "ASSIGNED" as const,
                      actorId: actor.id,
                      actorRole: actor.roles[0] ?? null,
                      summary: "按学生默认管家自动分配任务",
                      afterData: { ownerId: student.defaultButlerId },
                    },
                  ]
                : []),
            ],
          });
          taskCount += 1;
        }
      }

      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "STUDENT_SERVICE_ENABLED",
          objectType: "student",
          objectId: studentId,
          beforeData: {
            serviceStatus: "NOT_ENABLED",
            version: body.version,
          },
          afterData: {
            serviceStatus: "ENABLED",
            version: body.version + 1,
            activationId: activation.id,
            sopVersionId: sop.id,
            sopVersionNo: sop.versionNo,
            stageCount: sop.stages.length,
            taskCount,
            assignedOwnerId: student.defaultButlerId,
          },
        }),
      });

      return {
        activationId: activation.id,
        studentId,
        studentNo: student.studentNo,
        studentName: student.name,
        serviceStatus: "ENABLED" as const,
        version: body.version + 1,
        enabledAt: enabledAt.toISOString(),
        sopVersion: {
          id: sop.id,
          versionNo: sop.versionNo,
          displayVersion: `v${sop.versionNo}`,
        },
        stageCount: sop.stages.length,
        taskCount,
        assignedTaskCount: student.defaultButlerId ? taskCount : 0,
        unassignedTaskCount: student.defaultButlerId ? 0 : taskCount,
      };
    });
  }

  public async bulkAssign(
    studentId: string,
    body: BulkAssignUnassignedTasksDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const uniqueTaskIds = [...new Set(body.tasks.map((item) => item.taskId))];
    if (uniqueTaskIds.length !== body.tasks.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "同一任务不能重复提交",
      );
    }
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "批量分配必须提供长度不超过 128 字符的 Idempotency-Key",
      );
    }
    const operation = "TASK_BULK_ASSIGN";
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ studentId, ...body }))
      .digest("hex");
    const receiptKey = {
      actorId_operation_idempotencyKey: {
        actorId: actor.id,
        operation,
        idempotencyKey: key,
      },
    } as const;
    const firstTaskId = uniqueTaskIds[0]!;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.taskOperationReceipt.findUnique({
          where: receiptKey,
        });
        if (receipt) {
          if (receipt.taskId !== firstTaskId || receipt.requestFingerprint !== fingerprint) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              ErrorCode.IDEMPOTENCY_KEY_REUSED,
              "该 Idempotency-Key 已用于不同的批量分配请求",
            );
          }
          return receipt.responseData;
        }

        const student = await transaction.student.findUnique({
          where: { id: studentId },
          select: { id: true, serviceStatus: true },
        });
        if (!student) {
          throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
        }
        if (student.serviceStatus !== "ENABLED") {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.TASK_ASSIGNMENT_CONFLICT,
            "学生尚未启用服务，没有可分配任务",
          );
        }
        const butler = await transaction.user.findFirst({
          where: {
            id: body.butlerId,
            status: "ACTIVE",
            roles: {
              some: {
                expiredAt: null,
                role: { code: RoleCode.BUTLER },
              },
            },
          },
          select: { id: true, displayName: true },
        });
        if (!butler) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.RESPONSIBLE_PERSON_INVALID,
            "请选择有效的管家账号",
          );
        }

        const tasks = await transaction.taskInstance.findMany({
          where: { id: { in: uniqueTaskIds } },
          select: {
            id: true,
            studentId: true,
            ownerId: true,
            status: true,
            version: true,
            titleSnapshot: true,
          },
        });
        const byId = new Map(tasks.map((task) => [task.id, task]));
        const conflicts: Array<{
          taskId: string;
          reason: string;
          currentVersion?: number;
        }> = [];
        for (const requested of body.tasks) {
          const task = byId.get(requested.taskId);
          if (!task || task.studentId !== studentId) {
            conflicts.push({ taskId: requested.taskId, reason: "TASK_NOT_FOUND" });
          } else if (task.ownerId) {
            conflicts.push({
              taskId: requested.taskId,
              reason: "TASK_ALREADY_ASSIGNED",
              currentVersion: task.version,
            });
          } else if (
            !ACTIVE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_TASK_STATUSES)[number])
          ) {
            conflicts.push({
              taskId: requested.taskId,
              reason: "TASK_NOT_ACTIVE",
              currentVersion: task.version,
            });
          } else if (task.version !== requested.version) {
            conflicts.push({
              taskId: requested.taskId,
              reason: "TASK_VERSION_CONFLICT",
              currentVersion: task.version,
            });
          }
        }
        if (conflicts.length > 0) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.TASK_ASSIGNMENT_CONFLICT,
            "部分任务状态已变化，本次批量分配未执行",
            { conflicts },
          );
        }

        for (const requested of body.tasks) {
          const task = byId.get(requested.taskId)!;
          const updated = await transaction.taskInstance.updateMany({
            where: {
              id: task.id,
              studentId,
              ownerId: null,
              status: { in: [...ACTIVE_TASK_STATUSES] },
              version: requested.version,
            },
            data: {
              ownerId: butler.id,
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              ErrorCode.TASK_ASSIGNMENT_CONFLICT,
              "任务状态在提交期间发生变化，本次批量分配未执行",
              { conflicts: [{ taskId: task.id, reason: "CONCURRENT_UPDATE" }] },
            );
          }
          await transaction.taskReassignment.create({
            data: {
              taskId: task.id,
              oldOwnerId: null,
              newOwnerId: butler.id,
              reassignReason: body.reason.trim(),
              operatorId: actor.id,
            },
          });
          await transaction.taskTimelineEvent.create({
            data: {
              taskId: task.id,
              eventType: "ASSIGNED",
              actorId: actor.id,
              actorRole: actor.roles[0] ?? null,
              summary: `任务已分配给 ${butler.displayName}`,
              reason: body.reason.trim(),
              beforeData: { ownerId: null, version: requested.version },
              afterData: { ownerId: butler.id, version: requested.version + 1 },
            },
          });
          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "TASK_ASSIGNED",
              objectType: "task",
              objectId: task.id,
              beforeData: { ownerId: null, version: requested.version },
              afterData: { ownerId: butler.id, version: requested.version + 1 },
              reason: body.reason.trim(),
            }),
          });
        }

        const response = {
          studentId,
          assignedCount: body.tasks.length,
          butler,
          taskIds: uniqueTaskIds,
        };
        await transaction.taskOperationReceipt.create({
          data: {
            taskId: firstTaskId,
            actorId: actor.id,
            operation,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            responseData: response,
          },
        });
        return response;
      });
    } catch (error) {
      const receipt = await this.prisma.taskOperationReceipt.findUnique({
        where: receiptKey,
      });
      if (receipt && receipt.taskId === firstTaskId && receipt.requestFingerprint === fingerprint) {
        return receipt.responseData;
      }
      throw error;
    }
  }

  private calculateDueAt(enabledAt: Date, hours: number) {
    const dueAt = new Date(enabledAt.getTime() + hours * 60 * 60 * 1000);
    dueAt.setUTCSeconds(0, 0);
    return dueAt;
  }

  private auditData(
    request: RequestContext,
    event: {
      action: string;
      objectType: string;
      objectId: string;
      beforeData?: Prisma.InputJsonObject;
      afterData?: Prisma.InputJsonObject;
      reason?: string;
    },
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: event.objectType,
      objectId: event.objectId,
      action: event.action,
      beforeData: event.beforeData,
      afterData: event.afterData,
      reason: event.reason,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
