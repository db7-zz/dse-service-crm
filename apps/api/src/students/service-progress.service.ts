import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient, type StageTransitionTriggerType } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";

const ACTIVE_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;

export interface StageAdvanceResult {
  stageChanged: boolean;
  currentStage: null | {
    id: string;
    code: string;
    name: string;
    sequenceNo: number;
  };
  completedStageCount: number;
  advancedStages: Array<{
    id: string;
    code: string;
    name: string;
    sequenceNo: number;
  }>;
  progressVersion: number;
}

@Injectable()
export class ServiceProgressService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async advanceAfterTaskTerminal(
    transaction: Prisma.TransactionClient,
    taskId: string,
    triggerType: Extract<StageTransitionTriggerType, "TASK_COMPLETED" | "TASK_CANCELED">,
    request: RequestContext,
  ): Promise<StageAdvanceResult> {
    const initialTask = await transaction.taskInstance.findUniqueOrThrow({
      where: { id: taskId },
      select: {
        isBlockingSnapshot: true,
        stageInstanceId: true,
        serviceActivationId: true,
      },
    });
    await this.lockActivation(transaction, initialTask.serviceActivationId);

    const activation = await transaction.studentServiceActivation.findUniqueOrThrow({
      where: { id: initialTask.serviceActivationId },
      select: {
        id: true,
        calculationStatus: true,
        currentStageInstanceId: true,
        completedStageCount: true,
        progressVersion: true,
        currentStage: {
          select: {
            id: true,
            stageCodeSnapshot: true,
            nameSnapshot: true,
            sequenceNoSnapshot: true,
          },
        },
      },
    });
    if (activation.calculationStatus === "RECALCULATING") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SERVICE_PROGRESS_RECALCULATING,
        "服务进度正在重算，请稍后再执行任务操作",
      );
    }
    if (activation.calculationStatus === "ERROR") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SERVICE_PROGRESS_INCONSISTENT,
        "服务进度数据异常，请联系管理员处理后重试",
      );
    }
    if (
      !initialTask.isBlockingSnapshot ||
      !activation.currentStageInstanceId ||
      initialTask.stageInstanceId !== activation.currentStageInstanceId
    ) {
      await this.bumpProgressVersion(transaction, activation.id, activation.progressVersion);
      return {
        ...this.resultFromActivation(activation, []),
        progressVersion: activation.progressVersion + 1,
      };
    }

    const stages = await transaction.stageInstance.findMany({
      where: { serviceActivationId: activation.id },
      orderBy: { sequenceNoSnapshot: "asc" },
      select: {
        id: true,
        stageCodeSnapshot: true,
        nameSnapshot: true,
        sequenceNoSnapshot: true,
        status: true,
        version: true,
      },
    });
    if (stages.length !== 8) {
      throw this.inconsistent("服务阶段数量不是八个");
    }

    const currentIndex = stages.findIndex(
      (stage) => stage.id === activation.currentStageInstanceId,
    );
    if (currentIndex < 0 || stages[currentIndex]?.status !== "IN_PROGRESS") {
      throw this.inconsistent("当前阶段摘要与阶段实例不一致");
    }
    const currentOpenBlockers = await this.openBlockingTaskCount(
      transaction,
      activation.currentStageInstanceId,
    );
    if (currentOpenBlockers > 0) {
      await this.bumpProgressVersion(transaction, activation.id, activation.progressVersion);
      return {
        ...this.resultFromActivation(activation, []),
        progressVersion: activation.progressVersion + 1,
      };
    }

    const now = new Date();
    const advancedStages: StageAdvanceResult["advancedStages"] = [];
    let nextCurrent: StageAdvanceResult["currentStage"] = null;
    let completedStageCount = activation.completedStageCount;

    for (let index = currentIndex; index < stages.length; index += 1) {
      const stage = stages[index]!;
      if (stage.status === "NOT_STARTED") {
        await this.startStage(transaction, stage, now, taskId, request);
        stage.status = "IN_PROGRESS";
        stage.version += 1;
      }
      if (stage.status !== "IN_PROGRESS") {
        throw this.inconsistent(`第 ${stage.sequenceNoSnapshot} 阶段状态无法连续推进`);
      }

      const totalBlockers = await transaction.taskInstance.count({
        where: { stageInstanceId: stage.id, isBlockingSnapshot: true },
      });
      if (totalBlockers === 0) {
        throw this.inconsistent(`第 ${stage.sequenceNoSnapshot} 阶段没有阻塞任务`);
      }
      const openBlockers = await this.openBlockingTaskCount(transaction, stage.id);
      if (openBlockers > 0) {
        nextCurrent = this.stageSummary(stage);
        break;
      }

      const isInitialStage = index === currentIndex;
      const completionReason = isInitialStage
        ? triggerType === "TASK_COMPLETED"
          ? "最后一项阻塞任务已完成，系统自动推进"
          : "最后一项阻塞任务已取消，系统自动推进"
        : "前序阶段完成后，本阶段阻塞任务已全部进入终态";
      await this.completeStage(
        transaction,
        stage,
        now,
        isInitialStage ? triggerType : "CONTINUOUS_ADVANCE",
        taskId,
        completionReason,
        request,
      );
      stage.status = "COMPLETED";
      stage.version += 1;
      completedStageCount += 1;
      advancedStages.push(this.stageSummary(stage));

      const next = stages[index + 1];
      if (!next) {
        nextCurrent = null;
        break;
      }
      await this.startStage(transaction, next, now, taskId, request);
      next.status = "IN_PROGRESS";
      next.version += 1;
      const nextOpenBlockers = await this.openBlockingTaskCount(transaction, next.id);
      if (nextOpenBlockers > 0) {
        nextCurrent = this.stageSummary(next);
        break;
      }
    }

    const updated = await transaction.studentServiceActivation.updateMany({
      where: { id: activation.id, progressVersion: activation.progressVersion },
      data: {
        currentStageInstanceId: nextCurrent?.id ?? null,
        completedStageCount,
        progressVersion: { increment: 1 },
        lastCalculatedAt: now,
        calculationStatus: "NORMAL",
        calculationErrorCode: null,
      },
    });
    if (updated.count !== 1) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.STAGE_VERSION_CONFLICT,
        "阶段进度已被其他操作更新，请刷新后重试",
      );
    }

    return {
      stageChanged: advancedStages.length > 0,
      currentStage: nextCurrent,
      completedStageCount,
      advancedStages,
      progressVersion: activation.progressVersion + 1,
    };
  }

  public async recalculate(
    studentId: string,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "受控重算必须提供长度不超过 128 字符的 Idempotency-Key",
      );
    }
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const student = await transaction.student.findUnique({
          where: { id: studentId },
          select: { id: true, serviceActivation: { select: { id: true } } },
        });
        if (!student) {
          throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
        }
        if (!student.serviceActivation) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.SERVICE_NOT_ENABLED,
            "学生尚未启用服务，没有可重算的服务进度",
          );
        }
        await this.lockActivation(transaction, student.serviceActivation.id);
        const activation = await transaction.studentServiceActivation.findUniqueOrThrow({
          where: { id: student.serviceActivation.id },
          select: {
            id: true,
            enabledAt: true,
            calculationStatus: true,
            progressVersion: true,
          },
        });
        const existingRun = await transaction.serviceProgressCalculationRun.findUnique({
          where: {
            serviceActivationId_type_idempotencyKey: {
              serviceActivationId: activation.id,
              type: "RECALCULATION",
              idempotencyKey: key,
            },
          },
        });
        if (existingRun?.status === "COMPLETED") {
          return {
            calculationRunId: existingRun.id,
            ...(existingRun.changeSummary as Record<string, unknown>),
          };
        }
        if (activation.calculationStatus === "RECALCULATING") {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.SERVICE_PROGRESS_RECALCULATING,
            "服务进度正在重算，请勿重复提交",
          );
        }
        if (activation.calculationStatus !== "ERROR") {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.CONFLICT,
            "当前服务进度正常，无需执行受控重算",
          );
        }

        const run = existingRun
          ? await transaction.serviceProgressCalculationRun.update({
              where: { id: existingRun.id },
              data: {
                status: "RUNNING",
                requestId: request.requestId,
                errorCode: null,
                errorSummary: null,
              },
            })
          : await transaction.serviceProgressCalculationRun.create({
              data: {
                serviceActivationId: activation.id,
                type: "RECALCULATION",
                status: "RUNNING",
                initiatedById: actor.id,
                requestId: request.requestId,
                idempotencyKey: key,
              },
            });
        await transaction.studentServiceActivation.update({
          where: { id: activation.id },
          data: { calculationStatus: "RECALCULATING" },
        });

        const stages = await transaction.stageInstance.findMany({
          where: { serviceActivationId: activation.id },
          orderBy: { sequenceNoSnapshot: "asc" },
          include: {
            tasks: {
              where: { isBlockingSnapshot: true },
              select: {
                id: true,
                status: true,
                completedAt: true,
                canceledAt: true,
                updatedAt: true,
              },
            },
          },
        });
        if (
          stages.length !== 8 ||
          stages.some((stage, index) => stage.sequenceNoSnapshot !== index + 1)
        ) {
          throw this.inconsistent("阶段数量或顺序快照异常");
        }

        let completedStageCount = 0;
        let currentStageInstanceId: string | null = null;
        let cursor = activation.enabledAt;
        let reachedIncomplete = false;
        const now = new Date();
        for (const stage of stages) {
          if (stage.tasks.length === 0) {
            throw this.inconsistent(`第 ${stage.sequenceNoSnapshot} 阶段缺少阻塞任务`);
          }
          const allTerminal = stage.tasks.every(
            (task) => task.status === "COMPLETED" || task.status === "CANCELED",
          );
          const desiredStatus = !reachedIncomplete
            ? allTerminal
              ? "COMPLETED"
              : "IN_PROGRESS"
            : "NOT_STARTED";
          let startedAt: Date | null = null;
          let completedAt: Date | null = null;
          let completionReason: string | null = null;
          if (desiredStatus === "COMPLETED") {
            startedAt = cursor;
            const terminalTimes = stage.tasks.map(
              (task) => task.completedAt ?? task.canceledAt ?? task.updatedAt,
            );
            completedAt = new Date(
              Math.max(cursor.getTime(), ...terminalTimes.map((value) => value.getTime())),
            );
            cursor = completedAt;
            completionReason = "异常重算：本阶段阻塞任务已全部进入终态";
            completedStageCount += 1;
          } else if (desiredStatus === "IN_PROGRESS") {
            startedAt = cursor;
            currentStageInstanceId = stage.id;
            reachedIncomplete = true;
          } else {
            reachedIncomplete = true;
          }

          const changed =
            stage.status !== desiredStatus ||
            stage.startedAt?.getTime() !== startedAt?.getTime() ||
            stage.completedAt?.getTime() !== completedAt?.getTime();
          await transaction.stageInstance.update({
            where: { id: stage.id },
            data: {
              status: desiredStatus,
              startedAt,
              completedAt,
              completionReason,
              version: { increment: 1 },
            },
          });
          if (changed && desiredStatus !== "NOT_STARTED") {
            await transaction.stageTransition.create({
              data: {
                stageInstanceId: stage.id,
                fromStatus: stage.status,
                toStatus: desiredStatus,
                triggerType: "RECALCULATION",
                summary:
                  desiredStatus === "COMPLETED"
                    ? completionReason!
                    : "异常重算：系统确认本阶段为当前阶段",
                calculationRunId: run.id,
                deduplicationKey: `${stage.id}:${desiredStatus}:RECALCULATION:${run.id}`,
                createdAt: desiredStatus === "COMPLETED" ? completedAt! : startedAt!,
              },
            });
          }
        }

        const summary = {
          studentId,
          currentStageInstanceId,
          completedStageCount,
          progressVersion: activation.progressVersion + 1,
          recalculatedAt: now.toISOString(),
        };
        await transaction.studentServiceActivation.update({
          where: { id: activation.id },
          data: {
            currentStageInstanceId,
            completedStageCount,
            progressVersion: { increment: 1 },
            calculationStatus: "NORMAL",
            calculationErrorCode: null,
            lastCalculatedAt: now,
          },
        });
        await transaction.serviceProgressCalculationRun.update({
          where: { id: run.id },
          data: { status: "COMPLETED", changeSummary: summary, completedAt: now },
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "SERVICE_PROGRESS_RECALCULATED",
            objectType: "student_service_activation",
            objectId: activation.id,
            beforeData: {
              calculationStatus: activation.calculationStatus,
              progressVersion: activation.progressVersion,
            },
            afterData: summary,
            reason: "管理员对异常服务进度执行受控重算",
          }),
        });
        return { calculationRunId: run.id, ...summary };
      });
    } catch (error) {
      const shouldRecordFailure =
        !(error instanceof ApiException) || error.code === ErrorCode.SERVICE_PROGRESS_INCONSISTENT;
      if (shouldRecordFailure) {
        const errorCode = error instanceof ApiException ? error.code : ErrorCode.INTERNAL_ERROR;
        const errorSummary =
          error instanceof Error ? error.message.slice(0, 1000) : "受控重算发生未知错误";
        const activation = await this.prisma.studentServiceActivation.findUnique({
          where: { studentId },
          select: { id: true },
        });
        if (activation) {
          await this.prisma.$transaction(async (transaction) => {
            await transaction.studentServiceActivation.update({
              where: { id: activation.id },
              data: {
                calculationStatus: "ERROR",
                calculationErrorCode: errorCode,
              },
            });
            await transaction.serviceProgressCalculationRun.upsert({
              where: {
                serviceActivationId_type_idempotencyKey: {
                  serviceActivationId: activation.id,
                  type: "RECALCULATION",
                  idempotencyKey: key,
                },
              },
              update: {
                status: "FAILED",
                requestId: request.requestId,
                errorCode,
                errorSummary,
                completedAt: new Date(),
              },
              create: {
                serviceActivationId: activation.id,
                type: "RECALCULATION",
                status: "FAILED",
                initiatedById: actor.id,
                requestId: request.requestId,
                idempotencyKey: key,
                errorCode,
                errorSummary,
                completedAt: new Date(),
              },
            });
            await transaction.auditLog.create({
              data: this.auditData(request, {
                action: "SERVICE_PROGRESS_RECALCULATION_FAILED",
                objectType: "student_service_activation",
                objectId: activation.id,
                afterData: { errorCode },
                reason: errorSummary,
              }),
            });
          });
        }
      }
      throw error;
    }
  }

  private async startStage(
    transaction: Prisma.TransactionClient,
    stage: {
      id: string;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
      version: number;
      stageCodeSnapshot: string;
      nameSnapshot: string;
      sequenceNoSnapshot: number;
    },
    now: Date,
    triggerTaskId: string,
    request: RequestContext,
  ) {
    if (stage.status === "IN_PROGRESS") return;
    if (stage.status !== "NOT_STARTED") {
      throw this.inconsistent(`第 ${stage.sequenceNoSnapshot} 阶段不能重新开始`);
    }
    const changed = await transaction.stageInstance.updateMany({
      where: { id: stage.id, status: "NOT_STARTED", version: stage.version },
      data: { status: "IN_PROGRESS", startedAt: now, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw this.stageConflict();
    await this.recordTransition(transaction, request, {
      stage,
      fromStatus: "NOT_STARTED",
      toStatus: "IN_PROGRESS",
      triggerType: "CONTINUOUS_ADVANCE",
      triggerTaskId,
      summary: "前序阶段完成，系统启动本阶段",
      createdAt: now,
    });
  }

  private async completeStage(
    transaction: Prisma.TransactionClient,
    stage: {
      id: string;
      status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
      version: number;
      stageCodeSnapshot: string;
      nameSnapshot: string;
      sequenceNoSnapshot: number;
    },
    now: Date,
    triggerType: StageTransitionTriggerType,
    triggerTaskId: string,
    completionReason: string,
    request: RequestContext,
  ) {
    const changed = await transaction.stageInstance.updateMany({
      where: { id: stage.id, status: "IN_PROGRESS", version: stage.version },
      data: {
        status: "COMPLETED",
        completedAt: now,
        completionReason,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw this.stageConflict();
    await this.recordTransition(transaction, request, {
      stage,
      fromStatus: "IN_PROGRESS",
      toStatus: "COMPLETED",
      triggerType,
      triggerTaskId,
      summary: completionReason,
      createdAt: now,
    });
  }

  private async recordTransition(
    transaction: Prisma.TransactionClient,
    request: RequestContext,
    event: {
      stage: {
        id: string;
        stageCodeSnapshot: string;
        nameSnapshot: string;
        sequenceNoSnapshot: number;
      };
      fromStatus: "NOT_STARTED" | "IN_PROGRESS" | null;
      toStatus: "IN_PROGRESS" | "COMPLETED";
      triggerType: StageTransitionTriggerType;
      triggerTaskId: string;
      summary: string;
      createdAt: Date;
    },
  ) {
    const deduplicationKey = [
      event.stage.id,
      event.toStatus,
      event.triggerType,
      event.triggerTaskId,
    ].join(":");
    await transaction.stageTransition.create({
      data: {
        stageInstanceId: event.stage.id,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        triggerType: event.triggerType,
        triggerTaskId: event.triggerTaskId,
        summary: event.summary,
        deduplicationKey,
        createdAt: event.createdAt,
      },
    });
    await transaction.auditLog.create({
      data: this.auditData(request, {
        action:
          event.toStatus === "COMPLETED" ? "SERVICE_STAGE_COMPLETED" : "SERVICE_STAGE_STARTED",
        objectType: "stage_instance",
        objectId: event.stage.id,
        beforeData: { status: event.fromStatus },
        afterData: {
          status: event.toStatus,
          stageCode: event.stage.stageCodeSnapshot,
          stageName: event.stage.nameSnapshot,
          sequenceNo: event.stage.sequenceNoSnapshot,
          triggerType: event.triggerType,
          triggerTaskId: event.triggerTaskId,
        },
        reason: event.summary,
      }),
    });
  }

  private openBlockingTaskCount(transaction: Prisma.TransactionClient, stageInstanceId: string) {
    return transaction.taskInstance.count({
      where: {
        stageInstanceId,
        isBlockingSnapshot: true,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
  }

  private async lockActivation(transaction: Prisma.TransactionClient, activationId: string) {
    await transaction.$queryRaw<Array<{ lock: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${activationId}))::text AS lock
    `;
  }

  private async bumpProgressVersion(
    transaction: Prisma.TransactionClient,
    activationId: string,
    progressVersion: number,
  ) {
    const changed = await transaction.studentServiceActivation.updateMany({
      where: { id: activationId, progressVersion },
      data: { progressVersion: { increment: 1 }, lastCalculatedAt: new Date() },
    });
    if (changed.count !== 1) throw this.stageConflict();
  }

  private resultFromActivation(
    activation: {
      currentStage: null | {
        id: string;
        stageCodeSnapshot: string;
        nameSnapshot: string;
        sequenceNoSnapshot: number;
      };
      completedStageCount: number;
      progressVersion: number;
    },
    advancedStages: StageAdvanceResult["advancedStages"],
  ): StageAdvanceResult {
    return {
      stageChanged: advancedStages.length > 0,
      currentStage: activation.currentStage
        ? {
            id: activation.currentStage.id,
            code: activation.currentStage.stageCodeSnapshot,
            name: activation.currentStage.nameSnapshot,
            sequenceNo: activation.currentStage.sequenceNoSnapshot,
          }
        : null,
      completedStageCount: activation.completedStageCount,
      advancedStages,
      progressVersion: activation.progressVersion,
    };
  }

  private stageSummary(stage: {
    id: string;
    stageCodeSnapshot: string;
    nameSnapshot: string;
    sequenceNoSnapshot: number;
  }) {
    return {
      id: stage.id,
      code: stage.stageCodeSnapshot,
      name: stage.nameSnapshot,
      sequenceNo: stage.sequenceNoSnapshot,
    };
  }

  private inconsistent(reason: string) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.SERVICE_PROGRESS_INCONSISTENT,
      "服务进度数据不一致，任务操作未提交",
      { reason },
    );
  }

  private stageConflict() {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.STAGE_VERSION_CONFLICT,
      "阶段状态已变化，请刷新后重试",
    );
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
