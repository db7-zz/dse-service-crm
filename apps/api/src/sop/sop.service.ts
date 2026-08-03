import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type { PublishSopVersionDto, UpdateSopVersionDto } from "./sop.dto.js";
import { blockingStageValidationErrors } from "./sop-blocking.logic.js";

const BASELINE_STAGES = [
  ["PROFILE", "建档阶段"],
  ["ASSESSMENT", "学情评估阶段"],
  ["PLANNING", "升学规划阶段"],
  ["MATERIALS", "资料准备阶段"],
  ["ESSAYS", "文书准备阶段"],
  ["SUBMISSION", "申请递交阶段"],
  ["RESULTS", "申请结果跟进阶段"],
  ["ENROLLMENT", "入学确认阶段"],
] as const;

const SOP_INCLUDE = {
  createdBy: { select: { id: true, displayName: true } },
  sourceVersion: { select: { id: true, versionNo: true } },
  stages: {
    orderBy: { sequenceNo: "asc" as const },
    include: {
      tasks: { orderBy: { sequenceNo: "asc" as const } },
    },
  },
} as const;

type SopWithContent = Prisma.SopVersionGetPayload<{ include: typeof SOP_INCLUDE }>;

@Injectable()
export class SopService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list() {
    const versions = await this.prisma.sopVersion.findMany({
      include: SOP_INCLUDE,
      orderBy: { versionNo: "desc" },
    });
    return {
      items: versions.map((version) => this.serialize(version)),
      currentPublishedVersionId:
        versions.find((version) => version.status === "PUBLISHED")?.id ?? null,
      draftVersionId: versions.find((version) => version.status === "DRAFT")?.id ?? null,
    };
  }

  public async create(request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ lock: string }>>`
          SELECT pg_advisory_xact_lock(2026073101)::text AS lock
        `;
        const existingDraft = await transaction.sopVersion.findFirst({
          where: { status: "DRAFT" },
          select: { id: true, versionNo: true },
        });
        if (existingDraft) {
          throw new ApiException(
            HttpStatus.CONFLICT,
            ErrorCode.SOP_DRAFT_EXISTS,
            "当前已有可编辑的 SOP 草稿",
            { draftVersionId: existingDraft.id, versionNo: existingDraft.versionNo },
          );
        }

        const [source, latest] = await Promise.all([
          transaction.sopVersion.findFirst({
            where: { status: "PUBLISHED" },
            include: SOP_INCLUDE,
          }),
          transaction.sopVersion.aggregate({ _max: { versionNo: true } }),
        ]);
        const versionNo = (latest._max.versionNo ?? 0) + 1;
        const stages = source
          ? source.stages.map((stage) => ({
              stageCode: stage.stageCode,
              name: stage.name,
              sequenceNo: stage.sequenceNo,
              description: stage.description,
              tasks: {
                create: stage.tasks.map((task) => ({
                  name: task.name,
                  sequenceNo: task.sequenceNo,
                  description: task.description,
                  completionCriteria: task.completionCriteria,
                  completionWindowHours: task.completionWindowHours,
                  ownerRole: "BUTLER",
                  isBlocking: task.isBlocking,
                })),
              },
            }))
          : BASELINE_STAGES.map(([stageCode, name], index) => ({
              stageCode,
              name,
              sequenceNo: index + 1,
              description: null,
              tasks: { create: [] },
            }));
        const created = await transaction.sopVersion.create({
          data: {
            versionNo,
            sourceVersionId: source?.id ?? null,
            createdById: actor.id,
            stages: { create: stages },
          },
          include: SOP_INCLUDE,
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "SOP_DRAFT_CREATED",
            objectId: created.id,
            afterData: {
              versionNo,
              sourceVersionId: source?.id ?? null,
              stageCount: created.stages.length,
              taskCount: created.stages.reduce((total, stage) => total + stage.tasks.length, 0),
            },
          }),
        });
        return this.serialize(created);
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        const existingDraft = await this.prisma.sopVersion.findFirst({
          where: { status: "DRAFT" },
          select: { id: true, versionNo: true },
        });
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SOP_DRAFT_EXISTS,
          "当前已有可编辑的 SOP 草稿",
          existingDraft
            ? {
                draftVersionId: existingDraft.id,
                versionNo: existingDraft.versionNo,
              }
            : {},
        );
      }
      throw error;
    }
  }

  public async detail(versionId: string) {
    return this.serialize(await this.load(versionId));
  }

  public async update(versionId: string, body: UpdateSopVersionDto, request: RequestContext) {
    this.validateDraftShape(body);
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.sopVersion.findUnique({
        where: { id: versionId },
        include: SOP_INCLUDE,
      });
      this.assertEditable(existing, body.version);

      const result = await transaction.sopVersion.updateMany({
        where: { id: versionId, status: "DRAFT", version: body.version },
        data: { version: { increment: 1 } },
      });
      if (result.count !== 1) {
        const current = await transaction.sopVersion.findUniqueOrThrow({
          where: { id: versionId },
          select: { version: true },
        });
        throw this.versionConflict(current.version);
      }

      await transaction.sopStageTemplate.deleteMany({ where: { sopVersionId: versionId } });
      await transaction.sopVersion.update({
        where: { id: versionId },
        data: {
          stages: {
            create: body.stages.map((stage, stageIndex) => ({
              stageCode: stage.stageCode.trim().toUpperCase(),
              name: stage.name.trim(),
              sequenceNo: stageIndex + 1,
              description: this.optionalText(stage.description),
              tasks: {
                create: stage.tasks.map((task, taskIndex) => ({
                  name: task.name.trim(),
                  sequenceNo: taskIndex + 1,
                  description: this.optionalText(task.description),
                  completionCriteria: this.optionalText(task.completionCriteria),
                  completionWindowHours: task.completionWindowHours,
                  ownerRole: "BUTLER",
                  isBlocking: task.isBlocking,
                })),
              },
            })),
          },
        },
      });
      const updated = await transaction.sopVersion.findUniqueOrThrow({
        where: { id: versionId },
        include: SOP_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "SOP_DRAFT_UPDATED",
          objectId: versionId,
          beforeData: this.auditSnapshot(existing as SopWithContent),
          afterData: this.auditSnapshot(updated),
        }),
      });
      const beforeBlocking = this.blockingSnapshot(existing as SopWithContent);
      const afterBlocking = this.blockingSnapshot(updated);
      if (JSON.stringify(beforeBlocking) !== JSON.stringify(afterBlocking)) {
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "SOP_TASK_BLOCKING_CONFIGURATION_CHANGED",
            objectId: versionId,
            beforeData: { tasks: beforeBlocking },
            afterData: { tasks: afterBlocking },
            reason: "管理员保存 SOP 草稿阻塞任务配置",
          }),
        });
      }
      return this.serialize(updated);
    });
  }

  public async validate(versionId: string) {
    const version = await this.load(versionId);
    const errors = this.validationErrors(version);
    return {
      valid: errors.length === 0,
      errors,
      stageCount: version.stages.length,
      taskCount: version.stages.reduce((total, stage) => total + stage.tasks.length, 0),
    };
  }

  public async publish(versionId: string, body: PublishSopVersionDto, request: RequestContext) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw<Array<{ lock: string }>>`
          SELECT pg_advisory_xact_lock(2026073101)::text AS lock
        `;
        const draft = await transaction.sopVersion.findUnique({
          where: { id: versionId },
          include: SOP_INCLUDE,
        });
        this.assertEditable(draft, body.version);
        const errors = this.validationErrors(draft as SopWithContent);
        if (errors.length > 0) {
          const blockingError = errors.find(
            (error) => error.code === ErrorCode.STAGE_BLOCKING_TASK_REQUIRED,
          );
          throw new ApiException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            blockingError
              ? ErrorCode.STAGE_BLOCKING_TASK_REQUIRED
              : ErrorCode.SOP_VALIDATION_FAILED,
            blockingError ? blockingError.message : "SOP 完整性校验未通过",
            { errors },
          );
        }

        const publishedAt = new Date();
        const previous = await transaction.sopVersion.findFirst({
          where: { status: "PUBLISHED" },
          select: { id: true, versionNo: true },
        });
        if (previous) {
          await transaction.sopVersion.update({
            where: { id: previous.id },
            data: { status: "RETIRED", version: { increment: 1 } },
          });
          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "SOP_VERSION_RETIRED",
              objectId: previous.id,
              beforeData: { status: "PUBLISHED", versionNo: previous.versionNo },
              afterData: { status: "RETIRED", versionNo: previous.versionNo },
              reason: `发布 SOP v${draft?.versionNo ?? ""}`,
            }),
          });
        }
        const result = await transaction.sopVersion.updateMany({
          where: { id: versionId, status: "DRAFT", version: body.version },
          data: {
            status: "PUBLISHED",
            publishedAt,
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          const current = await transaction.sopVersion.findUniqueOrThrow({
            where: { id: versionId },
            select: { version: true },
          });
          throw this.versionConflict(current.version);
        }
        const published = await transaction.sopVersion.findUniqueOrThrow({
          where: { id: versionId },
          include: SOP_INCLUDE,
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "SOP_VERSION_PUBLISHED",
            objectId: versionId,
            beforeData: { status: "DRAFT", version: body.version },
            afterData: {
              status: "PUBLISHED",
              version: published.version,
              versionNo: published.versionNo,
              publishedAt: publishedAt.toISOString(),
            },
          }),
        });
        return this.serialize(published);
      });
    } catch (error) {
      if (error instanceof ApiException && error.code === ErrorCode.STAGE_BLOCKING_TASK_REQUIRED) {
        await this.prisma.auditLog.create({
          data: this.auditData(request, {
            action: "SOP_PUBLISH_REJECTED_NO_BLOCKING_TASK",
            objectId: versionId,
            afterData: (error.details ?? {}) as Prisma.InputJsonObject,
            reason: error.message,
          }),
        });
      }
      if (this.isUniqueConstraintError(error)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SOP_PUBLISH_CONFLICT,
          "另一个 SOP 版本已先完成发布，请刷新后重试",
        );
      }
      throw error;
    }
  }

  private async load(versionId: string) {
    const version = await this.prisma.sopVersion.findUnique({
      where: { id: versionId },
      include: SOP_INCLUDE,
    });
    if (!version) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "SOP 版本不存在");
    }
    return version;
  }

  private assertEditable(
    version: SopWithContent | null,
    expectedVersion: number,
  ): asserts version is SopWithContent {
    if (!version) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "SOP 版本不存在");
    }
    if (version.status !== "DRAFT") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SOP_IMMUTABLE,
        "已发布或已停用的 SOP 版本不可修改",
      );
    }
    if (version.version !== expectedVersion) {
      throw this.versionConflict(version.version);
    }
  }

  private validateDraftShape(body: UpdateSopVersionDto) {
    const codes = body.stages.map((stage) => stage.stageCode.trim().toUpperCase());
    if (new Set(codes).size !== codes.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "八个阶段的阶段代码不能重复",
      );
    }
    for (const stage of body.stages) {
      if (!stage.stageCode.trim() || !stage.name.trim()) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          "阶段代码和阶段名称不能为空",
        );
      }
      for (const task of stage.tasks) {
        if (!task.name.trim() || !Number.isInteger(task.completionWindowHours)) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "任务名称和整数小时完成时限不能为空",
          );
        }
      }
    }
  }

  private validationErrors(version: SopWithContent) {
    const errors: Array<{ path: string; message: string; code?: string }> = [];
    if (version.stages.length !== 8) {
      errors.push({ path: "stages", message: "SOP 必须包含且只能包含八个阶段" });
    }
    const sequences = version.stages.map((stage) => stage.sequenceNo);
    if (
      new Set(sequences).size !== 8 ||
      sequences.some((sequence) => sequence < 1 || sequence > 8)
    ) {
      errors.push({ path: "stages.sequenceNo", message: "阶段顺序必须唯一覆盖 1–8" });
    }
    errors.push(...blockingStageValidationErrors(version.stages));
    for (const stage of version.stages) {
      if (!stage.name.trim() || !stage.stageCode.trim()) {
        errors.push({
          path: `stages.${stage.sequenceNo}`,
          message: `第 ${stage.sequenceNo} 阶段的代码和名称不能为空`,
        });
      }
      if (stage.tasks.length === 0) {
        errors.push({
          path: `stages.${stage.sequenceNo}.tasks`,
          message: `${stage.name}至少需要一项任务`,
        });
      }
      for (const task of stage.tasks) {
        if (!task.name.trim()) {
          errors.push({
            path: `tasks.${task.id}.name`,
            message: `${stage.name}存在未命名任务`,
          });
        }
        if (!Number.isInteger(task.completionWindowHours) || task.completionWindowHours < 1) {
          errors.push({
            path: `tasks.${task.id}.completionWindowHours`,
            message: `${task.name || "未命名任务"}的完成时限必须为至少 1 小时的整数`,
          });
        }
      }
    }
    return errors;
  }

  private serialize(version: SopWithContent) {
    const taskCount = version.stages.reduce((total, stage) => total + stage.tasks.length, 0);
    return {
      id: version.id,
      versionNo: version.versionNo,
      displayVersion: `v${version.versionNo}`,
      status: version.status,
      sourceVersion: version.sourceVersion
        ? {
            id: version.sourceVersion.id,
            versionNo: version.sourceVersion.versionNo,
            displayVersion: `v${version.sourceVersion.versionNo}`,
          }
        : null,
      publishedAt: version.publishedAt?.toISOString() ?? null,
      createdBy: version.createdBy,
      version: version.version,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
      stageCount: version.stages.length,
      taskCount,
      stages: version.stages.map((stage) => ({
        id: stage.id,
        stageCode: stage.stageCode,
        name: stage.name,
        sequenceNo: stage.sequenceNo,
        description: stage.description,
        tasks: stage.tasks.map((task) => ({
          id: task.id,
          name: task.name,
          sequenceNo: task.sequenceNo,
          description: task.description,
          completionCriteria: task.completionCriteria,
          completionWindowHours: task.completionWindowHours,
          ownerRole: task.ownerRole,
          isBlocking: task.isBlocking,
        })),
      })),
    };
  }

  private auditSnapshot(version: SopWithContent): Prisma.InputJsonObject {
    return {
      versionNo: version.versionNo,
      status: version.status,
      version: version.version,
      stageCount: version.stages.length,
      taskCount: version.stages.reduce((total, stage) => total + stage.tasks.length, 0),
      blockingTaskCount: version.stages.reduce(
        (total, stage) => total + stage.tasks.filter((task) => task.isBlocking).length,
        0,
      ),
      blockingTasksByStage: version.stages.map((stage) => ({
        stageCode: stage.stageCode,
        count: stage.tasks.filter((task) => task.isBlocking).length,
      })),
    };
  }

  private blockingSnapshot(version: SopWithContent): Prisma.InputJsonArray {
    return version.stages.flatMap((stage) =>
      stage.tasks.map((task) => ({
        stageCode: stage.stageCode,
        stageSequenceNo: stage.sequenceNo,
        taskSequenceNo: task.sequenceNo,
        taskName: task.name,
        isBlocking: task.isBlocking,
      })),
    );
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.SOP_VERSION_CONFLICT,
      "SOP 草稿已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private auditData(
    request: RequestContext,
    event: {
      action: string;
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
      objectType: "sop_version",
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

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    );
  }
}
