import path from "node:path";
import { ConfigService } from "@nestjs/config";
import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient, type TaskStatus } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import type { Environment } from "../config/environment.js";
import { PRISMA } from "../database/database.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import type {
  ArchiveMaterialDto,
  CreateMaterialItemDto,
  MarkMaterialMissingDto,
  MaterialFollowupDto,
  ReviewMaterialDto,
  UploadMaterialVersionDto,
} from "./materials.dto.js";
import { FileStorageService } from "./file-storage.service.js";

const ALLOWED_FILES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
};

const MATERIAL_INCLUDE = {
  materialType: true,
  owner: { select: { id: true, displayName: true } },
  currentVersion: {
    include: {
      uploadedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
  },
  versions: {
    include: {
      uploadedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { versionNo: "desc" as const },
  },
  followups: {
    include: {
      followedBy: { select: { id: true, displayName: true } },
      task: { select: { id: true, titleSnapshot: true, status: true } },
    },
    orderBy: { followedAt: "desc" as const },
  },
} as const;

@Injectable()
export class MaterialsService {
  private readonly maxUploadBytes: number;

  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(FileStorageService) private readonly storage: FileStorageService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ServiceProgressService) private readonly progress: ServiceProgressService,
  ) {
    this.maxUploadBytes = config.get("MAX_UPLOAD_BYTES", { infer: true });
  }

  public async types() {
    return this.prisma.materialType.findMany({
      where: { isActive: true },
      orderBy: [{ isCore: "desc" }, { name: "asc" }],
    });
  }

  public async list(studentId: string, request: RequestContext) {
    await this.access.assertInternalAccess(studentId, request);
    const items = await this.prisma.materialItem.findMany({
      where: { studentId },
      include: MATERIAL_INCLUDE,
      orderBy: [{ materialType: { isCore: "desc" } }, { createdAt: "asc" }],
    });
    return {
      items: items.map((item) => this.serialize(item)),
      summary: this.summary(items),
    };
  }

  public async create(studentId: string, body: CreateMaterialItemDto, request: RequestContext) {
    await this.access.assertInternalAccess(studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    try {
      const item = await this.prisma.$transaction(async (transaction) => {
        const materialType = await transaction.materialType.findFirst({
          where: { id: body.materialTypeId, isActive: true },
        });
        if (!materialType) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "资料类型不存在或已停用",
          );
        }
        const created = await transaction.materialItem.create({
          data: {
            studentId,
            materialTypeId: materialType.id,
            title: body.title.trim(),
            requirement: this.optionalText(body.requirement),
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            ownerId: body.ownerId ?? null,
          },
          include: MATERIAL_INCLUDE,
        });
        await transaction.auditLog.create({
          data: this.audit(request, "material", created.id, "MATERIAL_ITEM_CREATED", {
            studentId,
            materialTypeCode: materialType.code,
            ownerId: body.ownerId ?? null,
          }),
        });
        if (materialType.isCore) {
          await this.ensureBlockingTask(transaction, created.id, actor.id, request);
        }
        return created;
      });
      return this.serialize(item);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "该学生已存在同类型资料项");
      }
      throw error;
    }
  }

  public async upload(
    materialId: string,
    body: UploadMaterialVersionDto,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const item = await this.loadAccessible(materialId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const content = this.decodeAndValidateFile(body);
    const nextVersionNo = (item.versions[0]?.versionNo ?? 0) + 1;
    const stored = await this.storage.put({
      namespace: "materials",
      ownerId: item.studentId,
      fileName: body.fileName,
      content,
    });
    const result = await this.prisma.$transaction(async (transaction) => {
      const version = await transaction.materialVersion.create({
        data: {
          materialItemId: item.id,
          versionNo: nextVersionNo,
          fileName: body.fileName.trim(),
          mimeType: body.mimeType,
          fileSize: content.length,
          storageKey: stored.storageKey,
          fileHash: stored.fileHash,
          uploadedById: actor.id,
        },
      });
      await transaction.materialItem.update({
        where: { id: item.id },
        data: {
          currentVersionId: version.id,
          status: "PENDING_REVIEW",
          version: { increment: 1 },
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, "material_version", version.id, "MATERIAL_VERSION_UPLOADED", {
          materialId: item.id,
          studentId: item.studentId,
          versionNo: nextVersionNo,
          fileName: body.fileName,
          fileSize: content.length,
          fileHash: stored.fileHash,
        }),
      });
      if (item.student.defaultButlerId && item.student.defaultButlerId !== actor.id) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: item.student.defaultButlerId,
          eventType: "MATERIAL_UPLOADED",
          title: `${item.student.name}上传了资料`,
          content: `${item.title}已有新版本等待审核`,
          objectType: "material",
          objectId: item.id,
          actionUrl: `/workspace/materials?studentId=${item.studentId}`,
          eventKey: `material-uploaded:${version.id}:${item.student.defaultButlerId}`,
        });
      }
      return version;
    });
    return {
      id: result.id,
      versionNo: result.versionNo,
      fileName: result.fileName,
      mimeType: result.mimeType,
      fileSize: result.fileSize,
      reviewStatus: result.reviewStatus,
      uploadedAt: result.uploadedAt.toISOString(),
    };
  }

  public async review(materialId: string, body: ReviewMaterialDto, request: RequestContext) {
    const item = await this.loadAccessible(materialId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (item.version !== body.version) throw this.versionConflict(item.version);
    if (!item.currentVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.MATERIAL_REVIEW_CONFLICT,
        "该资料尚未上传版本",
      );
    }
    const terminalTaskStatus: TaskStatus | null =
      body.outcome === "APPROVED"
        ? "COMPLETED"
        : body.outcome === "NOT_APPLICABLE"
          ? "NOT_APPLICABLE"
          : null;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.materialVersion.update({
        where: { id: item.currentVersion!.id },
        data: {
          reviewStatus: body.outcome === "APPROVED" ? "APPROVED" : "REJECTED",
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewComment: this.optionalText(body.comment),
        },
      });
      await transaction.materialItem.update({
        where: { id: item.id },
        data: { status: body.outcome, version: { increment: 1 } },
      });
      if (terminalTaskStatus) {
        await this.closeBlockingTask(transaction, item.id, terminalTaskStatus, request);
      }
      await transaction.auditLog.create({
        data: this.audit(request, "material", item.id, "MATERIAL_REVIEWED", {
          outcome: body.outcome,
          comment: body.comment ?? null,
          versionId: item.currentVersion!.id,
        }),
      });
    });
    return this.loadSerialized(item.id);
  }

  public async markMissing(
    materialId: string,
    body: MarkMaterialMissingDto,
    request: RequestContext,
  ) {
    const item = await this.loadAccessible(materialId, request);
    if (item.version !== body.version) throw this.versionConflict(item.version);
    const expectedSubmitAt = new Date(body.expectedSubmitAt);
    if (expectedSubmitAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "补交时间必须晚于当前时间",
      );
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.prisma.$transaction(async (transaction) => {
      const owner = await transaction.user.findFirst({
        where: { id: body.ownerId, status: "ACTIVE" },
        select: { id: true },
      });
      if (!owner) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.RESPONSIBLE_PERSON_INVALID,
          "缺失资料责任人无效",
        );
      }
      await transaction.materialItem.update({
        where: { id: item.id },
        data: {
          status: "PARTIALLY_MISSING",
          missingReason: body.missingReason.trim(),
          ownerId: owner.id,
          expectedSubmitAt,
          version: { increment: 1 },
        },
      });
      await this.closeBlockingTask(transaction, item.id, "NOT_APPLICABLE", request);
      await transaction.materialFollowup.create({
        data: {
          materialItemId: item.id,
          followupNote: `已制定补交计划：${body.missingReason.trim()}`,
          followedById: actor.id,
        },
      });
      const recipients = new Set(
        [item.student.portalUserId, item.student.defaultButlerId, owner.id].filter(
          (value): value is string => Boolean(value),
        ),
      );
      for (const recipientId of recipients) {
        await this.notifications.createInTransaction(transaction, {
          recipientId,
          eventType: "MATERIAL_MISSING",
          title: `${item.student.name}存在缺失资料`,
          content: `${item.title}计划于${expectedSubmitAt.toLocaleDateString("zh-CN")}前补交`,
          objectType: "material",
          objectId: item.id,
          actionUrl:
            recipientId === item.student.portalUserId
              ? "/portal/materials"
              : `/workspace/materials?studentId=${item.studentId}`,
          eventKey: `material-missing:${item.id}:${body.version}:${recipientId}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, "material", item.id, "MATERIAL_MARKED_MISSING", {
          missingReason: body.missingReason.trim(),
          ownerId: owner.id,
          expectedSubmitAt: expectedSubmitAt.toISOString(),
        }),
      });
    });
    return this.loadSerialized(item.id);
  }

  public async followup(materialId: string, body: MaterialFollowupDto, request: RequestContext) {
    const item = await this.loadAccessible(materialId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const result = await this.prisma.$transaction(async (transaction) => {
      let taskId: string | null = null;
      if (body.createTask) {
        if (!body.dueAt || new Date(body.dueAt).getTime() <= Date.now()) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "创建催收任务时必须填写未来截止时间",
          );
        }
        const task = await this.createFollowupTask(
          transaction,
          item.id,
          body.note,
          new Date(body.dueAt),
          actor.id,
          request,
        );
        taskId = task.id;
      }
      const followup = await transaction.materialFollowup.create({
        data: {
          materialItemId: item.id,
          taskId,
          followupNote: body.note.trim(),
          followedById: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, "material", item.id, "MATERIAL_FOLLOWUP_RECORDED", {
          followupId: followup.id,
          taskId,
        }),
      });
      return followup;
    });
    return { id: result.id, taskId: result.taskId, followedAt: result.followedAt.toISOString() };
  }

  public async archive(materialId: string, body: ArchiveMaterialDto, request: RequestContext) {
    const item = await this.loadAccessible(materialId, request);
    await this.prisma.materialItem.update({
      where: { id: item.id },
      data: {
        archiveStatus: body.archiveStatus,
        archivedAt: body.archiveStatus === "ARCHIVED" ? new Date() : null,
        archiveNote: body.note.trim(),
        version: { increment: 1 },
      },
    });
    await this.prisma.auditLog.create({
      data: this.audit(request, "material", item.id, "MATERIAL_ARCHIVE_RECORDED", {
        archiveStatus: body.archiveStatus,
        note: body.note.trim(),
      }),
    });
    return this.loadSerialized(item.id);
  }

  public async download(versionId: string, request: RequestContext, expectedStudentId?: string) {
    const version = await this.prisma.materialVersion.findUnique({
      where: { id: versionId },
      include: { materialItem: { include: { student: true } } },
    });
    if (!version || (expectedStudentId && version.materialItem.studentId !== expectedStudentId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "资料版本不存在");
    }
    if (!expectedStudentId) {
      await this.access.assertInternalAccess(version.materialItem.studentId, request);
    }
    await this.prisma.auditLog.create({
      data: this.audit(request, "material_version", version.id, "MATERIAL_DOWNLOADED", {
        materialId: version.materialItemId,
        fileName: version.fileName,
      }),
    });
    return {
      buffer: await this.storage.read(version.storageKey),
      fileName: version.fileName,
      mimeType: version.mimeType,
    };
  }

  private async loadAccessible(
    materialId: string,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const item = await this.prisma.materialItem.findUnique({
      where: { id: materialId },
      include: {
        ...MATERIAL_INCLUDE,
        student: {
          select: {
            id: true,
            name: true,
            defaultButlerId: true,
            plannerId: true,
            portalUserId: true,
          },
        },
      },
    });
    if (!item || (expectedStudentId && item.studentId !== expectedStudentId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "资料项不存在");
    }
    if (!expectedStudentId) await this.access.assertInternalAccess(item.studentId, request);
    return item;
  }

  private async loadSerialized(materialId: string) {
    const item = await this.prisma.materialItem.findUniqueOrThrow({
      where: { id: materialId },
      include: MATERIAL_INCLUDE,
    });
    return this.serialize(item);
  }

  private serialize(item: Prisma.MaterialItemGetPayload<{ include: typeof MATERIAL_INCLUDE }>) {
    return {
      id: item.id,
      studentId: item.studentId,
      materialType: item.materialType,
      title: item.title,
      requirement: item.requirement,
      dueAt: item.dueAt?.toISOString() ?? null,
      owner: item.owner,
      status: item.status,
      missingReason: item.missingReason,
      expectedSubmitAt: item.expectedSubmitAt?.toISOString() ?? null,
      archiveStatus: item.archiveStatus,
      archivedAt: item.archivedAt?.toISOString() ?? null,
      archiveNote: item.archiveNote,
      version: item.version,
      currentVersion: item.currentVersion ? this.serializeVersion(item.currentVersion) : null,
      versions: item.versions.map((version) => this.serializeVersion(version)),
      followups: item.followups.map((followup) => ({
        id: followup.id,
        note: followup.followupNote,
        followedBy: followup.followedBy,
        followedAt: followup.followedAt.toISOString(),
        task: followup.task
          ? {
              id: followup.task.id,
              title: followup.task.titleSnapshot,
              status: followup.task.status,
            }
          : null,
      })),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  private serializeVersion(
    version: Prisma.MaterialVersionGetPayload<{
      include: {
        uploadedBy: { select: { id: true; displayName: true } };
        reviewedBy: { select: { id: true; displayName: true } };
      };
    }>,
  ) {
    return {
      id: version.id,
      versionNo: version.versionNo,
      fileName: version.fileName,
      mimeType: version.mimeType,
      fileSize: version.fileSize,
      uploadedBy: version.uploadedBy,
      uploadedAt: version.uploadedAt.toISOString(),
      reviewStatus: version.reviewStatus,
      reviewedBy: version.reviewedBy,
      reviewedAt: version.reviewedAt?.toISOString() ?? null,
      reviewComment: version.reviewComment,
      downloadUrl: `/api/v1/materials/versions/${version.id}/download`,
    };
  }

  private summary(items: Array<{ status: string; materialType: { isCore: boolean } }>) {
    return {
      total: items.length,
      approved: items.filter((item) => item.status === "APPROVED").length,
      pendingReview: items.filter((item) => item.status === "PENDING_REVIEW").length,
      missing: items.filter((item) =>
        ["PARTIALLY_MISSING", "RESUBMISSION_REQUIRED"].includes(item.status),
      ).length,
      missingCore: items.filter(
        (item) => item.materialType.isCore && !["APPROVED", "NOT_APPLICABLE"].includes(item.status),
      ).length,
    };
  }

  private decodeAndValidateFile(body: UploadMaterialVersionDto) {
    const extension = path.extname(body.fileName).toLowerCase();
    if (!ALLOWED_FILES[extension]?.includes(body.mimeType)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        "仅支持PDF、DOC、DOCX、JPG、JPEG和PNG文件",
      );
    }
    const content = Buffer.from(body.contentBase64, "base64");
    if (content.length === 0 || content.length > this.maxUploadBytes) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        `文件不能为空且不得超过${Math.floor(this.maxUploadBytes / 1024 / 1024)}MB`,
      );
    }
    return content;
  }

  private async ensureBlockingTask(
    transaction: Prisma.TransactionClient,
    materialId: string,
    actorId: string,
    request: RequestContext,
  ) {
    const item = await transaction.materialItem.findUniqueOrThrow({
      where: { id: materialId },
      include: { student: { include: { serviceActivation: true } }, materialType: true },
    });
    if (!item.student.serviceActivation) return null;
    const existing = await transaction.taskInstance.findFirst({
      where: { sourceType: "MATERIAL", sourceObjectId: item.id },
    });
    if (existing) return existing;
    const stage = await transaction.stageInstance.findFirst({
      where: {
        serviceActivationId: item.student.serviceActivation.id,
        stageCodeSnapshot: "MATERIALS",
      },
    });
    if (!stage) return null;
    const dueAt = item.dueAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const task = await transaction.taskInstance.create({
      data: {
        studentId: item.studentId,
        serviceActivationId: item.student.serviceActivation.id,
        stageInstanceId: stage.id,
        sopVersionId: item.student.serviceActivation.sopVersionId,
        sourceType: "MATERIAL",
        sourceObjectId: item.id,
        isBlockingSnapshot: true,
        createdById: actorId,
        titleSnapshot: `完成核心资料：${item.title}`,
        completionCriteriaSnapshot: "资料审核通过，或已记录缺失原因、责任人与补交时间",
        ownerId: item.ownerId ?? item.student.defaultButlerId,
        originalDueAt: dueAt,
        currentDueAt: dueAt,
        externalVisible: true,
      },
    });
    await transaction.taskTimelineEvent.create({
      data: {
        taskId: task.id,
        eventType: "CREATED",
        actorId,
        actorRole: (request.authenticatedUser as AuthenticatedUser).roles[0] ?? null,
        summary: "核心资料项生成阶段阻塞任务",
        afterData: { materialId: item.id },
      },
    });
    return task;
  }

  private async closeBlockingTask(
    transaction: Prisma.TransactionClient,
    materialId: string,
    status: Extract<TaskStatus, "COMPLETED" | "NOT_APPLICABLE">,
    request: RequestContext,
  ) {
    const task = await transaction.taskInstance.findFirst({
      where: {
        sourceType: "MATERIAL",
        sourceObjectId: materialId,
        status: { in: ["TODO", "IN_PROGRESS"] },
      },
    });
    if (!task) return;
    const actor = request.authenticatedUser as AuthenticatedUser;
    await transaction.taskInstance.update({
      where: { id: task.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
        completionNote:
          status === "COMPLETED" ? "关联资料已审核通过" : "关联资料已建立完整补交计划",
        version: { increment: 1 },
      },
    });
    await transaction.taskTimelineEvent.create({
      data: {
        taskId: task.id,
        eventType: status === "COMPLETED" ? "COMPLETED" : "MARKED_NOT_APPLICABLE",
        actorId: actor.id,
        actorRole: actor.roles[0] ?? null,
        summary:
          status === "COMPLETED"
            ? "资料审核通过，阻塞任务完成"
            : "资料补交计划完整，阻塞任务不再阻塞",
      },
    });
    await this.progress.advanceAfterTaskTerminal(
      transaction,
      task.id,
      status === "COMPLETED" ? "TASK_COMPLETED" : "TASK_NOT_APPLICABLE",
      request,
    );
  }

  private async createFollowupTask(
    transaction: Prisma.TransactionClient,
    materialId: string,
    note: string,
    dueAt: Date,
    actorId: string,
    request: RequestContext,
  ) {
    const item = await transaction.materialItem.findUniqueOrThrow({
      where: { id: materialId },
      include: { student: { include: { serviceActivation: true } } },
    });
    if (!item.student.serviceActivation) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SERVICE_NOT_ENABLED,
        "学生尚未启用服务，不能创建关联催收任务",
      );
    }
    const stage = await transaction.stageInstance.findFirstOrThrow({
      where: {
        serviceActivationId: item.student.serviceActivation.id,
        stageCodeSnapshot: "MATERIALS",
      },
    });
    const task = await transaction.taskInstance.create({
      data: {
        studentId: item.studentId,
        serviceActivationId: item.student.serviceActivation.id,
        stageInstanceId: stage.id,
        sopVersionId: item.student.serviceActivation.sopVersionId,
        sourceType: "MATERIAL",
        sourceObjectId: item.id,
        isBlockingSnapshot: false,
        createdById: actorId,
        titleSnapshot: `催收资料：${item.title}`,
        descriptionSnapshot: note.trim(),
        completionCriteriaSnapshot: "记录本次催收结果或收到补交资料",
        ownerId: item.ownerId ?? item.student.defaultButlerId,
        originalDueAt: dueAt,
        currentDueAt: dueAt,
        externalVisible: false,
      },
    });
    await transaction.taskTimelineEvent.create({
      data: {
        taskId: task.id,
        eventType: "CREATED",
        actorId,
        actorRole: (request.authenticatedUser as AuthenticatedUser).roles[0] ?? null,
        summary: "由资料催收记录创建任务",
      },
    });
    return task;
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.MATERIAL_VERSION_CONFLICT,
      "资料已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private audit(
    request: RequestContext,
    objectType: string,
    objectId: string,
    action: string,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType,
      objectId,
      action,
      afterData,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
