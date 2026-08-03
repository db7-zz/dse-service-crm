import { createHash } from "node:crypto";
import path from "node:path";
import { ConfigService } from "@nestjs/config";
import { ErrorCode, PermissionCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type { Environment } from "../config/environment.js";
import { FileStorageService } from "../materials/file-storage.service.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import type {
  AddTaskProgressDto,
  AddTaskEvidenceDto,
  CancelTaskDto,
  CompleteTaskDto,
  HandleOverdueAlertDto,
  ListOverdueAlertsQueryDto,
  ListTasksQueryDto,
  MarkTaskNotApplicableDto,
  ReassignTaskDto,
  ReportTaskExtensionDto,
  ReopenTaskDto,
  RescheduleTaskDto,
  TaskVersionDto,
} from "./task.dto.js";
import { OverdueScannerService } from "./overdue-scanner.service.js";

const ACTIVE_STATUSES = ["TODO", "IN_PROGRESS"] as const;

const EVIDENCE_FILE_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
};

const TASK_LIST_INCLUDE = {
  student: { select: { id: true, studentNo: true, name: true } },
  stageInstance: {
    select: {
      id: true,
      stageCodeSnapshot: true,
      nameSnapshot: true,
      sequenceNoSnapshot: true,
    },
  },
  taskTemplate: { select: { sequenceNo: true } },
  owner: { select: { id: true, displayName: true } },
  sopVersion: { select: { id: true, versionNo: true } },
  overdueAlerts: {
    where: { status: { in: ["OPEN", "HANDLED"] } },
    orderBy: { generatedAt: "desc" as const },
    take: 1,
  },
  extensionReports: {
    select: {
      extensionReason: true,
      expectedFinishAt: true,
      reportedAt: true,
    },
    orderBy: { reportedAt: "desc" as const },
    take: 1,
  },
} satisfies Prisma.TaskInstanceInclude;

const TASK_DETAIL_INCLUDE = {
  ...TASK_LIST_INCLUDE,
  progressRecords: {
    include: { createdBy: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  extensionReports: {
    include: { reportedBy: { select: { id: true, displayName: true } } },
    orderBy: { reportedAt: "desc" as const },
  },
  dueDateChanges: {
    include: { operator: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  reassignments: {
    include: {
      oldOwner: { select: { id: true, displayName: true } },
      newOwner: { select: { id: true, displayName: true } },
      operator: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
  overdueAlerts: {
    orderBy: { generatedAt: "desc" as const },
  },
  timelineEvents: {
    include: { actor: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  evidence: {
    include: { uploadedBy: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.TaskInstanceInclude;

type TaskListRecord = Prisma.TaskInstanceGetPayload<{ include: typeof TASK_LIST_INCLUDE }>;
type TaskDetailRecord = Prisma.TaskInstanceGetPayload<{ include: typeof TASK_DETAIL_INCLUDE }>;

@Injectable()
export class TasksService {
  private readonly maxUploadBytes: number;

  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(OverdueScannerService)
    private readonly overdueScanner: OverdueScannerService,
    @Inject(ServiceProgressService)
    private readonly serviceProgress: ServiceProgressService,
    @Inject(FileStorageService)
    private readonly storage: FileStorageService,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
  ) {
    this.maxUploadBytes = config.get("MAX_UPLOAD_BYTES", { infer: true });
  }

  public async listMine(query: ListTasksQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.overdueScanner.scan();
    return this.list(query, actor.id);
  }

  public async listForSupervision(query: ListTasksQueryDto) {
    await this.overdueScanner.scan();
    return this.list(query);
  }

  public async supervisionSummary(query: ListTasksQueryDto) {
    await this.overdueScanner.scan();
    const where = this.taskWhere(query);
    const now = new Date();
    const tasks = await this.prisma.taskInstance.findMany({
      where,
      select: {
        status: true,
        ownerId: true,
        currentDueAt: true,
        overdueAlerts: {
          where: { status: "OPEN" },
          select: { id: true },
        },
      },
    });
    return {
      taskCount: tasks.length,
      inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      overdue: tasks.filter(
        (task) =>
          ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number]) &&
          task.currentDueAt < now,
      ).length,
      unassigned: tasks.filter(
        (task) =>
          !task.ownerId &&
          ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number]),
      ).length,
      openAlerts: tasks.reduce((total, task) => total + task.overdueAlerts.length, 0),
    };
  }

  public async detail(taskId: string, request: RequestContext) {
    await this.overdueScanner.scan();
    const task = await this.prisma.taskInstance.findUnique({
      where: { id: taskId },
      include: TASK_DETAIL_INCLUDE,
    });
    if (!task) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务不存在");
    }
    this.assertCanRead(task.ownerId, request.authenticatedUser as AuthenticatedUser);
    return this.serializeDetail(task);
  }

  public async timeline(taskId: string, request: RequestContext) {
    const task = await this.prisma.taskInstance.findUnique({
      where: { id: taskId },
      select: {
        ownerId: true,
        timelineEvents: {
          include: { actor: { select: { id: true, displayName: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!task) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务不存在");
    }
    this.assertCanRead(task.ownerId, request.authenticatedUser as AuthenticatedUser);
    return {
      items: task.timelineEvents.map((event) => this.serializeTimeline(event)),
    };
  }

  public start(
    taskId: string,
    body: TaskVersionDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_START",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadTaskForWrite(transaction, taskId, body.version, actor, [
          "TODO",
        ]);
        const now = new Date();
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          status: "IN_PROGRESS",
          startedAt: now,
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "STARTED",
          summary: "管家开始执行任务",
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "IN_PROGRESS", version: body.version + 1 },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_STARTED",
          taskId,
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "IN_PROGRESS", version: body.version + 1 },
        });
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public addProgress(
    taskId: string,
    body: AddTaskProgressDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_PROGRESS",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadTaskForWrite(transaction, taskId, body.version, actor, [
          "IN_PROGRESS",
        ]);
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          ...(body.progressPercent !== undefined ? { progressPercent: body.progressPercent } : {}),
        });
        await transaction.taskProgressRecord.create({
          data: {
            taskId,
            progressNote: body.progressNote.trim(),
            progressPercent: body.progressPercent,
            createdById: actor.id,
          },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "PROGRESS_UPDATED",
          summary:
            body.progressPercent === undefined
              ? "管家更新任务进展"
              : `任务进度更新为 ${body.progressPercent}%`,
          beforeData: {
            progressPercent: task.progressPercent,
            version: body.version,
          },
          afterData: {
            progressPercent: body.progressPercent ?? task.progressPercent,
            progressNote: body.progressNote.trim(),
            version: body.version + 1,
          },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_PROGRESS_UPDATED",
          taskId,
          beforeData: {
            progressPercent: task.progressPercent,
            version: body.version,
          },
          afterData: {
            progressPercent: body.progressPercent ?? task.progressPercent,
            progressNote: body.progressNote.trim(),
            version: body.version + 1,
          },
        });
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public reportExtension(
    taskId: string,
    body: ReportTaskExtensionDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_EXTENSION",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadTaskForWrite(transaction, taskId, body.version, actor, [
          ...ACTIVE_STATUSES,
        ]);
        const expectedFinishAt = new Date(body.expectedFinishAt);
        if (expectedFinishAt <= task.currentDueAt) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "预计完成时间必须晚于当前截止时间",
          );
        }
        await this.updateTaskVersioned(transaction, taskId, body.version, {});
        await transaction.taskExtensionReport.create({
          data: {
            taskId,
            extensionReason: body.reason.trim(),
            expectedFinishAt,
            reportedById: actor.id,
          },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "EXTENSION_REPORTED",
          summary: "管家提交延期报备",
          reason: body.reason.trim(),
          afterData: {
            expectedFinishAt: expectedFinishAt.toISOString(),
            currentDueAt: task.currentDueAt.toISOString(),
            version: body.version + 1,
          },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_EXTENSION_REPORTED",
          taskId,
          afterData: {
            expectedFinishAt: expectedFinishAt.toISOString(),
            currentDueAt: task.currentDueAt.toISOString(),
            version: body.version + 1,
          },
          reason: body.reason.trim(),
        });
        const managers = await transaction.user.findMany({
          where: {
            status: "ACTIVE",
            roles: { some: { expiredAt: null, role: { code: "ADMINISTRATOR" } } },
          },
          select: { id: true },
        });
        for (const manager of managers) {
          const eventKey = `task-extension:${taskId}:${body.version}:${manager.id}`;
          await transaction.notification.upsert({
            where: { eventKey },
            update: {},
            create: {
              recipientId: manager.id,
              eventType: "TASK_EXTENSION_REPORTED",
              title: "收到任务延期报备",
              content: task.titleSnapshot,
              objectType: "task",
              objectId: taskId,
              actionUrl: `/workspace/tasks/${taskId}`,
              eventKey,
            },
          });
        }
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public complete(
    taskId: string,
    body: CompleteTaskDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_COMPLETE",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadTaskForWrite(transaction, taskId, body.version, actor, [
          "IN_PROGRESS",
        ]);
        if (task.evidenceRequiredSnapshot) {
          const evidenceCount = await transaction.taskEvidence.count({ where: { taskId } });
          if (evidenceCount === 0) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              ErrorCode.TASK_STATE_CONFLICT,
              "该任务要求上传完成凭证，请先添加凭证再完成任务",
            );
          }
        }
        const completedAt = new Date();
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          status: "COMPLETED",
          progressPercent: 100,
          completedAt,
          completionNote: body.completionNote.trim(),
        });
        await this.resolveAlerts(transaction, taskId, request, "TASK_COMPLETED");
        await transaction.applicationRequirement.updateMany({
          where: { linkedTaskId: taskId, status: { not: "COMPLETED" } },
          data: { status: "COMPLETED" },
        });
        await transaction.issue.updateMany({
          where: { convertedTaskId: taskId, status: "CONVERTED_TO_TASK" },
          data: { status: "RESOLVED", version: { increment: 1 } },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "COMPLETED",
          summary: "管家完成任务",
          beforeData: { status: task.status, version: body.version },
          afterData: {
            status: "COMPLETED",
            progressPercent: 100,
            completionNote: body.completionNote.trim(),
            version: body.version + 1,
          },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_COMPLETED",
          taskId,
          beforeData: { status: task.status, version: body.version },
          afterData: {
            status: "COMPLETED",
            progressPercent: 100,
            version: body.version + 1,
          },
        });
        const stageProgress = await this.serviceProgress.advanceAfterTaskTerminal(
          transaction,
          taskId,
          "TASK_COMPLETED",
          request,
        );
        return { ...(await this.loadSerializedDetail(transaction, taskId)), ...stageProgress };
      },
    );
  }

  public markNotApplicable(
    taskId: string,
    body: MarkTaskNotApplicableDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_NOT_APPLICABLE",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadTaskForWrite(transaction, taskId, body.version, actor, [
          ...ACTIVE_STATUSES,
        ]);
        const completedAt = new Date();
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          status: "NOT_APPLICABLE",
          completedAt,
          completionNote: body.reason.trim(),
        });
        await this.resolveAlerts(transaction, taskId, request, "TASK_NOT_APPLICABLE");
        await transaction.applicationRequirement.updateMany({
          where: { linkedTaskId: taskId },
          data: { status: "WAIVED" },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "MARKED_NOT_APPLICABLE",
          summary: "执行人将任务标记为不适用",
          reason: body.reason.trim(),
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "NOT_APPLICABLE", version: body.version + 1 },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_MARKED_NOT_APPLICABLE",
          taskId,
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "NOT_APPLICABLE", version: body.version + 1 },
          reason: body.reason.trim(),
        });
        const stageProgress = await this.serviceProgress.advanceAfterTaskTerminal(
          transaction,
          taskId,
          "TASK_NOT_APPLICABLE",
          request,
        );
        return { ...(await this.loadSerializedDetail(transaction, taskId)), ...stageProgress };
      },
    );
  }

  public addEvidence(
    taskId: string,
    body: AddTaskEvidenceDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeIdempotent(
      taskId,
      "TASK_EVIDENCE_ADD",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        await this.loadTaskForWrite(transaction, taskId, body.version, actor, [...ACTIVE_STATUSES]);
        const extension = path.extname(body.fileName).toLowerCase();
        if (!EVIDENCE_FILE_TYPES[extension]?.includes(body.mimeType.toLowerCase())) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.MATERIAL_FILE_INVALID,
            "凭证仅支持 PDF、Word、JPG 和 PNG 文件，且文件类型必须匹配",
          );
        }
        const content = Buffer.from(body.contentBase64, "base64");
        if (content.length === 0 || content.length > this.maxUploadBytes) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.MATERIAL_FILE_INVALID,
            `凭证大小必须在 1 字节到 ${Math.floor(this.maxUploadBytes / 1024 / 1024)}MB 之间`,
          );
        }
        const stored = await this.storage.put({
          namespace: "task-evidence",
          ownerId: taskId,
          fileName: body.fileName,
          content,
        });
        const evidence = await transaction.taskEvidence.create({
          data: {
            taskId,
            fileName: body.fileName.trim(),
            mimeType: body.mimeType.toLowerCase(),
            fileSize: content.length,
            storageKey: stored.storageKey,
            fileHash: stored.fileHash,
            uploadedById: actor.id,
          },
        });
        await this.updateTaskVersioned(transaction, taskId, body.version, {});
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "EVIDENCE_ADDED",
          summary: `已添加任务凭证：${evidence.fileName}`,
          afterData: { evidenceId: evidence.id, version: body.version + 1 },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_EVIDENCE_ADDED",
          taskId,
          afterData: {
            evidenceId: evidence.id,
            fileName: evidence.fileName,
            fileHash: evidence.fileHash,
          },
        });
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public async downloadEvidence(taskId: string, evidenceId: string, request: RequestContext) {
    const evidence = await this.prisma.taskEvidence.findFirst({
      where: { id: evidenceId, taskId },
      include: { task: { select: { ownerId: true } } },
    });
    if (!evidence) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务凭证不存在");
    }
    this.assertCanRead(evidence.task.ownerId, request.authenticatedUser as AuthenticatedUser);
    await this.prisma.auditLog.create({
      data: this.auditData(request, {
        action: "TASK_EVIDENCE_DOWNLOADED",
        objectType: "task_evidence",
        objectId: evidence.id,
        afterData: { taskId, fileName: evidence.fileName },
      }),
    });
    return {
      buffer: await this.storage.read(evidence.storageKey),
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
    };
  }

  public reschedule(
    taskId: string,
    body: RescheduleTaskDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeAdminWrite(
      taskId,
      "TASK_RESCHEDULE",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadAdminTaskForWrite(transaction, taskId, body.version, [
          ...ACTIVE_STATUSES,
        ]);
        const newDueAt = new Date(body.newDueAt);
        if (newDueAt <= new Date()) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "新截止时间必须晚于当前时间",
          );
        }
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          currentDueAt: newDueAt,
        });
        await transaction.taskDueDateChange.create({
          data: {
            taskId,
            oldDueAt: task.currentDueAt,
            newDueAt,
            changeReason: body.reason.trim(),
            operatorId: actor.id,
          },
        });
        await this.resolveAlerts(transaction, taskId, request, "TASK_RESCHEDULED");
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "RESCHEDULED",
          summary: "管理员调整任务截止时间",
          reason: body.reason.trim(),
          beforeData: {
            currentDueAt: task.currentDueAt.toISOString(),
            version: body.version,
          },
          afterData: {
            currentDueAt: newDueAt.toISOString(),
            originalDueAt: task.originalDueAt.toISOString(),
            version: body.version + 1,
          },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_RESCHEDULED",
          taskId,
          beforeData: {
            currentDueAt: task.currentDueAt.toISOString(),
            version: body.version,
          },
          afterData: {
            currentDueAt: newDueAt.toISOString(),
            originalDueAt: task.originalDueAt.toISOString(),
            version: body.version + 1,
          },
          reason: body.reason.trim(),
        });
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public reassign(
    taskId: string,
    body: ReassignTaskDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeAdminWrite(
      taskId,
      "TASK_REASSIGN",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadAdminTaskForWrite(transaction, taskId, body.version, [
          ...ACTIVE_STATUSES,
        ]);
        const butler = await transaction.user.findFirst({
          where: {
            id: body.newOwnerId,
            status: "ACTIVE",
            roles: {
              some: { expiredAt: null, role: { code: "BUTLER" } },
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
        if (task.ownerId === butler.id) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "新管家不能与当前执行人相同",
          );
        }
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          ownerId: butler.id,
        });
        await transaction.taskReassignment.create({
          data: {
            taskId,
            oldOwnerId: task.ownerId,
            newOwnerId: butler.id,
            reassignReason: body.reason.trim(),
            operatorId: actor.id,
          },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "REASSIGNED",
          summary: `管理员将任务转派给 ${butler.displayName}`,
          reason: body.reason.trim(),
          beforeData: { ownerId: task.ownerId, version: body.version },
          afterData: { ownerId: butler.id, version: body.version + 1 },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_REASSIGNED",
          taskId,
          beforeData: { ownerId: task.ownerId, version: body.version },
          afterData: { ownerId: butler.id, version: body.version + 1 },
          reason: body.reason.trim(),
        });
        const reassignRecipients = new Set([task.ownerId, butler.id].filter(Boolean) as string[]);
        for (const recipientId of reassignRecipients) {
          const eventKey = `task-reassigned:${taskId}:${body.version}:${recipientId}`;
          await transaction.notification.upsert({
            where: { eventKey },
            update: {},
            create: {
              recipientId,
              eventType: "TASK_REASSIGNED",
              title: recipientId === butler.id ? "任务已转派给你" : "你的任务已转派",
              content: task.titleSnapshot,
              objectType: "task",
              objectId: taskId,
              actionUrl: `/workspace/tasks/${taskId}`,
              eventKey,
            },
          });
        }
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public cancel(
    taskId: string,
    body: CancelTaskDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeAdminWrite(
      taskId,
      "TASK_CANCEL",
      body,
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const task = await this.loadAdminTaskForWrite(transaction, taskId, body.version, [
          ...ACTIVE_STATUSES,
        ]);
        const canceledAt = new Date();
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          status: "CANCELED",
          canceledAt,
          canceledById: actor.id,
          cancelReason: body.reason.trim(),
        });
        await this.resolveAlerts(transaction, taskId, request, "TASK_CANCELED");
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "CANCELED",
          summary: "管理员取消任务",
          reason: body.reason.trim(),
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "CANCELED", version: body.version + 1 },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_CANCELED",
          taskId,
          beforeData: { status: task.status, version: body.version },
          afterData: { status: "CANCELED", version: body.version + 1 },
          reason: body.reason.trim(),
        });
        const stageProgress = await this.serviceProgress.advanceAfterTaskTerminal(
          transaction,
          taskId,
          "TASK_CANCELED",
          request,
        );
        return { ...(await this.loadSerializedDetail(transaction, taskId)), ...stageProgress };
      },
    );
  }

  public reopen(
    taskId: string,
    body: ReopenTaskDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    return this.executeAdminWrite(
      taskId,
      "TASK_REOPEN",
      body,
      idempotencyKey,
      request,
      async (transaction) => {
        const task = await transaction.taskInstance.findUnique({
          where: { id: taskId },
          include: { stageInstance: { select: { status: true } } },
        });
        if (!task) {
          throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务不存在");
        }
        if (task.version !== body.version) throw this.taskVersionConflict(task.version);
        if (!["COMPLETED", "CANCELED", "NOT_APPLICABLE"].includes(task.status)) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.TASK_STATE_CONFLICT,
            "只有已结束的任务可以重新打开",
          );
        }
        if (task.isBlockingSnapshot && task.stageInstance.status === "COMPLETED") {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.TASK_STATE_CONFLICT,
            "该任务所属阶段已经完成，不能直接重新打开；请先由管理员处理阶段进度",
          );
        }
        const now = new Date();
        const newDueAt = body.newDueAt
          ? new Date(body.newDueAt)
          : task.currentDueAt > now
            ? task.currentDueAt
            : new Date(now.getTime() + 24 * 60 * 60 * 1000);
        if (newDueAt <= now) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "重新打开后的截止时间必须晚于当前时间",
          );
        }
        await this.updateTaskVersioned(transaction, taskId, body.version, {
          status: "TODO",
          progressPercent: null,
          currentDueAt: newDueAt,
          startedAt: null,
          completedAt: null,
          completionNote: null,
          canceledAt: null,
          canceledById: null,
          cancelReason: null,
        });
        await transaction.applicationRequirement.updateMany({
          where: { linkedTaskId: taskId },
          data: { status: "OPEN" },
        });
        await transaction.issue.updateMany({
          where: { convertedTaskId: taskId, status: "RESOLVED" },
          data: { status: "CONVERTED_TO_TASK", version: { increment: 1 } },
        });
        await this.recordTimeline(transaction, request, {
          taskId,
          eventType: "REOPENED",
          summary: "管理员重新打开任务",
          reason: body.reason.trim(),
          beforeData: { status: task.status, version: body.version },
          afterData: {
            status: "TODO",
            currentDueAt: newDueAt.toISOString(),
            version: body.version + 1,
          },
        });
        await this.recordTaskAudit(transaction, request, {
          action: "TASK_REOPENED",
          taskId,
          beforeData: { status: task.status, version: body.version },
          afterData: {
            status: "TODO",
            currentDueAt: newDueAt.toISOString(),
            version: body.version + 1,
          },
          reason: body.reason.trim(),
        });
        return this.loadSerializedDetail(transaction, taskId);
      },
    );
  }

  public async listAlerts(query: ListOverdueAlertsQueryDto) {
    await this.overdueScanner.scan();
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const requestedPage = Math.max(1, Number(query.page) || 1);
    const where: Prisma.OverdueAlertWhereInput = query.status
      ? { status: query.status }
      : { status: { in: ["OPEN", "HANDLED"] } };
    const total = await this.prisma.overdueAlert.count({ where });
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const items = await this.prisma.overdueAlert.findMany({
      where,
      include: {
        handledBy: { select: { id: true, displayName: true } },
        task: { include: TASK_LIST_INCLUDE },
      },
      orderBy: [{ status: "asc" }, { generatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((alert) => ({
        id: alert.id,
        episode: alert.overdueEpisodeNo,
        status: alert.status,
        firstOverdueAt: alert.firstOverdueAt.toISOString(),
        generatedAt: alert.generatedAt.toISOString(),
        handledBy: alert.handledBy,
        handledAt: alert.handledAt?.toISOString() ?? null,
        resolvedAt: alert.resolvedAt?.toISOString() ?? null,
        resolvedReason: alert.resolvedReason,
        task: this.serializeListTask(alert.task),
      })),
      page,
      pageSize,
      total,
    };
  }

  public async handleAlert(
    alertId: string,
    body: HandleOverdueAlertDto,
    idempotencyKey: string | undefined,
    request: RequestContext,
  ) {
    const alert = await this.prisma.overdueAlert.findUnique({
      where: { id: alertId },
      select: { taskId: true },
    });
    if (!alert) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "逾期提醒不存在");
    }
    return this.executeAdminWrite(
      alert.taskId,
      "OVERDUE_ALERT_HANDLE",
      { alertId, ...body },
      idempotencyKey,
      request,
      async (transaction, actor) => {
        const current = await transaction.overdueAlert.findUnique({
          where: { id: alertId },
        });
        if (!current) {
          throw new ApiException(
            HttpStatus.NOT_FOUND,
            ErrorCode.RESOURCE_NOT_FOUND,
            "逾期提醒不存在",
          );
        }
        if (current.status !== "OPEN") {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.OVERDUE_ALERT_CONFLICT,
            current.status === "HANDLED" ? "该提醒已被处理" : "该提醒已经解除，不能再处理",
            { currentStatus: current.status },
          );
        }
        const now = new Date();
        await transaction.overdueAlert.update({
          where: { id: alertId },
          data: {
            status: "HANDLED",
            handledById: actor.id,
            handledAt: now,
          },
        });
        await this.recordTimeline(transaction, request, {
          taskId: current.taskId,
          eventType: "OVERDUE_ALERT_HANDLED",
          summary: "管理员已处理逾期提醒",
          reason: body.note?.trim(),
          beforeData: { alertId, status: "OPEN" },
          afterData: { alertId, status: "HANDLED" },
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "OVERDUE_ALERT_HANDLED",
            objectType: "overdue_alert",
            objectId: alertId,
            beforeData: { status: "OPEN" },
            afterData: { status: "HANDLED", taskId: current.taskId },
            reason: body.note?.trim(),
          }),
        });
        return {
          id: alertId,
          taskId: current.taskId,
          status: "HANDLED",
          handledAt: now.toISOString(),
          handledBy: { id: actor.id, displayName: actor.displayName },
        };
      },
    );
  }

  private async list(query: ListTasksQueryDto, ownerId?: string) {
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const requestedPage = Math.max(1, Number(query.page) || 1);
    const where = this.taskWhere(query, ownerId);
    const total = await this.prisma.taskInstance.count({ where });
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
    const items = await this.prisma.taskInstance.findMany({
      where,
      include: TASK_LIST_INCLUDE,
      orderBy: [{ currentDueAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((task) => this.serializeListTask(task)),
      page,
      pageSize,
      total,
    };
  }

  private taskWhere(query: ListTasksQueryDto, forcedOwnerId?: string) {
    const now = new Date();
    return {
      ...(query.status ? { status: query.status } : { status: { in: [...ACTIVE_STATUSES] } }),
      ...(!forcedOwnerId && query.ownerId ? { ownerId: query.ownerId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.stageCode
        ? {
            stageInstance: {
              stageCodeSnapshot: query.stageCode.trim().toUpperCase(),
            },
          }
        : {}),
      ...(!forcedOwnerId && query.unassigned === true ? { ownerId: null } : {}),
      ...(query.openAlert === true
        ? {
            overdueAlerts: {
              some: { status: "OPEN" as const },
            },
          }
        : {}),
      ...(query.overdue === true
        ? {
            status: { in: [...ACTIVE_STATUSES] },
            currentDueAt: { lt: now },
          }
        : {}),
      ...(query.overdue === false
        ? {
            OR: [{ status: { in: ["COMPLETED", "CANCELED"] } }, { currentDueAt: { gte: now } }],
          }
        : {}),
      ...(query.dueFrom || query.dueTo
        ? {
            currentDueAt: {
              ...(query.dueFrom ? { gte: new Date(query.dueFrom) } : {}),
              ...(query.dueTo ? { lte: new Date(query.dueTo) } : {}),
              ...(query.overdue === true ? { lt: now } : {}),
            },
          }
        : {}),
      ...(forcedOwnerId ? { ownerId: forcedOwnerId } : {}),
    } satisfies Prisma.TaskInstanceWhereInput;
  }

  private assertCanRead(ownerId: string | null, actor: AuthenticatedUser) {
    if (actor.permissions.includes(PermissionCode.TASK_SUPERVISION_READ)) {
      return;
    }
    if (actor.permissions.includes(PermissionCode.TASKS_OWN_READ) && ownerId === actor.id) {
      return;
    }
    throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权查看该任务");
  }

  private async loadTaskForWrite(
    transaction: Prisma.TransactionClient,
    taskId: string,
    version: number,
    actor: AuthenticatedUser,
    allowedStatuses: Array<"TODO" | "IN_PROGRESS">,
  ) {
    const task = await this.loadAdminTaskForWrite(transaction, taskId, version, allowedStatuses);
    if (!task.ownerId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.TASK_NOT_ASSIGNED,
        "未分配任务不能执行，请联系管理员先分配管家",
      );
    }
    if (task.ownerId !== actor.id) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.TASK_OWNERSHIP_FORBIDDEN,
        "任务已分配给其他管家",
      );
    }
    return task;
  }

  private async loadAdminTaskForWrite(
    transaction: Prisma.TransactionClient,
    taskId: string,
    version: number,
    allowedStatuses: Array<"TODO" | "IN_PROGRESS">,
  ) {
    const task = await transaction.taskInstance.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务不存在");
    }
    if (task.version !== version) {
      throw this.taskVersionConflict(task.version);
    }
    if (!allowedStatuses.includes(task.status as "TODO" | "IN_PROGRESS")) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.TASK_STATE_CONFLICT,
        "当前任务状态不允许执行该操作",
        { currentStatus: task.status, currentVersion: task.version },
      );
    }
    return task;
  }

  private async updateTaskVersioned(
    transaction: Prisma.TransactionClient,
    taskId: string,
    version: number,
    data: Prisma.TaskInstanceUncheckedUpdateManyInput,
  ) {
    const changed = await transaction.taskInstance.updateMany({
      where: { id: taskId, version },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1) {
      const current = await transaction.taskInstance.findUniqueOrThrow({
        where: { id: taskId },
        select: { version: true },
      });
      throw this.taskVersionConflict(current.version);
    }
  }

  private async resolveAlerts(
    transaction: Prisma.TransactionClient,
    taskId: string,
    request: RequestContext,
    reason: string,
  ) {
    const alerts = await transaction.overdueAlert.findMany({
      where: { taskId, status: { in: ["OPEN", "HANDLED"] } },
      select: { id: true, status: true },
    });
    const resolvedAt = new Date();
    for (const alert of alerts) {
      await transaction.overdueAlert.update({
        where: { id: alert.id },
        data: {
          status: "RESOLVED",
          resolvedAt,
          resolvedReason: reason,
        },
      });
      await this.recordTimeline(transaction, request, {
        taskId,
        eventType: "OVERDUE_ALERT_RESOLVED",
        summary: "逾期提醒已解除",
        reason,
        beforeData: { alertId: alert.id, status: alert.status },
        afterData: { alertId: alert.id, status: "RESOLVED" },
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "OVERDUE_ALERT_RESOLVED",
          objectType: "overdue_alert",
          objectId: alert.id,
          beforeData: { status: alert.status },
          afterData: { status: "RESOLVED", taskId, reason },
        }),
      });
    }
  }

  private async executeAdminWrite<T extends object>(
    taskId: string,
    operation: string,
    body: object,
    idempotencyKey: string | undefined,
    request: RequestContext,
    action: (transaction: Prisma.TransactionClient, actor: AuthenticatedUser) => Promise<T>,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (!actor.permissions.includes(PermissionCode.TASK_SUPERVISION_WRITE)) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权执行管理员任务操作");
    }
    return this.executeIdempotent(taskId, operation, body, idempotencyKey, request, action);
  }

  private async executeIdempotent<T extends object>(
    taskId: string,
    operation: string,
    body: object,
    idempotencyKey: string | undefined,
    request: RequestContext,
    action: (transaction: Prisma.TransactionClient, actor: AuthenticatedUser) => Promise<T>,
  ): Promise<T> {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const key = idempotencyKey?.trim();
    if (!key || key.length > 128) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "任务写操作必须提供长度不超过 128 字符的 Idempotency-Key",
      );
    }
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const receipt = await transaction.taskOperationReceipt.findUnique({
          where: {
            actorId_operation_idempotencyKey: {
              actorId: actor.id,
              operation,
              idempotencyKey: key,
            },
          },
        });
        if (receipt) {
          if (receipt.taskId !== taskId || receipt.requestFingerprint !== fingerprint) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              ErrorCode.IDEMPOTENCY_KEY_REUSED,
              "该 Idempotency-Key 已用于不同请求",
            );
          }
          return receipt.responseData as T;
        }
        const result = await action(transaction, actor);
        await transaction.taskOperationReceipt.create({
          data: {
            taskId,
            actorId: actor.id,
            operation,
            idempotencyKey: key,
            requestFingerprint: fingerprint,
            responseData: result as Prisma.InputJsonObject,
          },
        });
        return result;
      });
    } catch (error) {
      const receipt = await this.prisma.taskOperationReceipt.findUnique({
        where: {
          actorId_operation_idempotencyKey: {
            actorId: actor.id,
            operation,
            idempotencyKey: key,
          },
        },
      });
      if (receipt && receipt.taskId === taskId && receipt.requestFingerprint === fingerprint) {
        return receipt.responseData as T;
      }
      if (
        error instanceof ApiException &&
        (
          [
            ErrorCode.STAGE_VERSION_CONFLICT,
            ErrorCode.SERVICE_PROGRESS_INCONSISTENT,
            ErrorCode.SERVICE_PROGRESS_RECALCULATING,
          ] as readonly string[]
        ).includes(error.code)
      ) {
        await this.prisma.$transaction(async (transaction) => {
          if (error.code === ErrorCode.SERVICE_PROGRESS_INCONSISTENT) {
            const task = await transaction.taskInstance.findUnique({
              where: { id: taskId },
              select: { serviceActivationId: true, studentId: true },
            });
            if (task) {
              await transaction.studentServiceActivation.update({
                where: { id: task.serviceActivationId },
                data: {
                  calculationStatus: "ERROR",
                  calculationErrorCode: ErrorCode.SERVICE_PROGRESS_INCONSISTENT,
                },
              });
              await transaction.auditLog.create({
                data: this.auditData(request, {
                  action: "SERVICE_PROGRESS_CALCULATION_FAILED",
                  objectType: "student_service_activation",
                  objectId: task.serviceActivationId,
                  afterData: {
                    studentId: task.studentId,
                    triggerTaskId: taskId,
                    errorCode: error.code,
                    details: (error.details ?? {}) as Prisma.InputJsonObject,
                  },
                  reason: error.message,
                }),
              });
            }
          }
          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "SERVICE_PROGRESS_CONFLICT",
              objectType: "task",
              objectId: taskId,
              afterData: {
                operation,
                errorCode: error.code,
                details: (error.details ?? {}) as Prisma.InputJsonObject,
              },
              reason: error.message,
            }),
          });
        });
      }
      throw error;
    }
  }

  private async loadSerializedDetail(transaction: Prisma.TransactionClient, taskId: string) {
    const task = await transaction.taskInstance.findUniqueOrThrow({
      where: { id: taskId },
      include: TASK_DETAIL_INCLUDE,
    });
    return this.serializeDetail(task);
  }

  private serializeListTask(task: TaskListRecord) {
    const isActive = ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number]);
    return {
      id: task.id,
      title: task.titleSnapshot,
      status: task.status,
      progressPercent: task.progressPercent,
      student: task.student,
      stage: {
        id: task.stageInstance.id,
        code: task.stageInstance.stageCodeSnapshot,
        name: task.stageInstance.nameSnapshot,
        sequenceNo: task.stageInstance.sequenceNoSnapshot,
      },
      taskSequenceNo: task.taskTemplate?.sequenceNo ?? null,
      sourceType: task.sourceType,
      sourceObjectId: task.sourceObjectId,
      isBlocking: task.isBlockingSnapshot,
      evidenceRequired: task.evidenceRequiredSnapshot,
      externalVisible: task.externalVisible,
      owner: task.owner,
      originalDueAt: task.originalDueAt.toISOString(),
      currentDueAt: task.currentDueAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
      isOverdue: isActive && task.currentDueAt.getTime() < Date.now(),
      activeAlert: task.overdueAlerts[0]
        ? {
            id: task.overdueAlerts[0].id,
            status: task.overdueAlerts[0].status,
            episode: task.overdueAlerts[0].overdueEpisodeNo,
          }
        : null,
      latestExtension: task.extensionReports[0]
        ? {
            reason: task.extensionReports[0].extensionReason,
            expectedFinishAt: task.extensionReports[0].expectedFinishAt.toISOString(),
            reportedAt: task.extensionReports[0].reportedAt.toISOString(),
          }
        : null,
      sopVersion: {
        id: task.sopVersion.id,
        versionNo: task.sopVersion.versionNo,
        displayVersion: `v${task.sopVersion.versionNo}`,
      },
      version: task.version,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
    };
  }

  private serializeDetail(task: TaskDetailRecord) {
    return {
      ...this.serializeListTask(task),
      description: task.descriptionSnapshot,
      completionCriteria: task.completionCriteriaSnapshot,
      completionWindowHours: task.completionWindowHoursSnapshot,
      completionNote: task.completionNote,
      canceledAt: task.canceledAt?.toISOString() ?? null,
      cancelReason: task.cancelReason,
      evidence: task.evidence.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        mimeType: item.mimeType,
        fileSize: item.fileSize,
        fileHash: item.fileHash,
        uploadedBy: item.uploadedBy,
        createdAt: item.createdAt.toISOString(),
      })),
      progressRecords: task.progressRecords.map((record) => ({
        id: record.id,
        note: record.progressNote,
        percent: record.progressPercent,
        createdBy: record.createdBy,
        createdAt: record.createdAt.toISOString(),
      })),
      extensionReports: task.extensionReports.map((report) => ({
        id: report.id,
        reason: report.extensionReason,
        expectedFinishAt: report.expectedFinishAt.toISOString(),
        reportedBy: report.reportedBy,
        reportedAt: report.reportedAt.toISOString(),
      })),
      dueDateChanges: task.dueDateChanges.map((change) => ({
        id: change.id,
        oldDueAt: change.oldDueAt.toISOString(),
        newDueAt: change.newDueAt.toISOString(),
        reason: change.changeReason,
        operator: change.operator,
        createdAt: change.createdAt.toISOString(),
      })),
      reassignments: task.reassignments.map((change) => ({
        id: change.id,
        oldOwner: change.oldOwner,
        newOwner: change.newOwner,
        reason: change.reassignReason,
        operator: change.operator,
        createdAt: change.createdAt.toISOString(),
      })),
      overdueAlerts: task.overdueAlerts.map((alert) => ({
        id: alert.id,
        episode: alert.overdueEpisodeNo,
        status: alert.status,
        firstOverdueAt: alert.firstOverdueAt.toISOString(),
        generatedAt: alert.generatedAt.toISOString(),
        handledAt: alert.handledAt?.toISOString() ?? null,
        resolvedAt: alert.resolvedAt?.toISOString() ?? null,
        resolvedReason: alert.resolvedReason,
      })),
      timeline: task.timelineEvents.map((event) => this.serializeTimeline(event)),
    };
  }

  private serializeTimeline(event: {
    id: string;
    eventType: string;
    actor: { id: string; displayName: string } | null;
    actorRole: string | null;
    summary: string;
    reason: string | null;
    beforeData: Prisma.JsonValue | null;
    afterData: Prisma.JsonValue | null;
    createdAt: Date;
  }) {
    return {
      id: event.id,
      eventType: event.eventType,
      actor: event.actor,
      actorRole: event.actorRole,
      summary: event.summary,
      reason: event.reason,
      beforeData: event.beforeData,
      afterData: event.afterData,
      createdAt: event.createdAt.toISOString(),
    };
  }

  private async recordTimeline(
    transaction: Prisma.TransactionClient,
    request: RequestContext,
    event: {
      taskId: string;
      eventType:
        | "STARTED"
        | "PROGRESS_UPDATED"
        | "EXTENSION_REPORTED"
        | "RESCHEDULED"
        | "REASSIGNED"
        | "COMPLETED"
        | "CANCELED"
        | "MARKED_NOT_APPLICABLE"
        | "REOPENED"
        | "EVIDENCE_ADDED"
        | "OVERDUE_ALERT_HANDLED"
        | "OVERDUE_ALERT_RESOLVED";
      summary: string;
      reason?: string;
      beforeData?: Prisma.InputJsonObject;
      afterData?: Prisma.InputJsonObject;
    },
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    await transaction.taskTimelineEvent.create({
      data: {
        taskId: event.taskId,
        eventType: event.eventType,
        actorId: actor.id,
        actorRole: actor.roles[0] ?? null,
        summary: event.summary,
        reason: event.reason,
        beforeData: event.beforeData,
        afterData: event.afterData,
      },
    });
  }

  private recordTaskAudit(
    transaction: Prisma.TransactionClient,
    request: RequestContext,
    event: {
      action: string;
      taskId: string;
      beforeData?: Prisma.InputJsonObject;
      afterData?: Prisma.InputJsonObject;
      reason?: string;
    },
  ) {
    return transaction.auditLog.create({
      data: this.auditData(request, {
        action: event.action,
        objectType: "task",
        objectId: event.taskId,
        beforeData: event.beforeData,
        afterData: event.afterData,
        reason: event.reason,
      }),
    });
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

  private taskVersionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.TASK_VERSION_CONFLICT,
      "任务已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }
}
