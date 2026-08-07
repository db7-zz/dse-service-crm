import { createHash } from "node:crypto";
import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type {
  ApplySopMaterialBackfillDto,
  PreviewSopMaterialBackfillDto,
  PublishSopVersionDto,
  UpdateSopVersionDto,
} from "./sop.dto.js";
import { blockingStageValidationErrors } from "./sop-blocking.logic.js";
import {
  calculateMaterialDueAt,
  matchesMaterialCondition,
  parseMaterialConditionRule,
} from "../materials/material-template.logic.js";

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
      materials: {
        orderBy: { sequenceNo: "asc" as const },
        include: { materialType: true },
      },
    },
  },
} as const;

type SopWithContent = Prisma.SopVersionGetPayload<{ include: typeof SOP_INCLUDE }>;
type MaterialBackfillClient = Pick<PrismaClient, "sopVersion" | "student" | "materialItem">;

interface MaterialBackfillCandidate {
  studentId: string;
  studentNo: string;
  studentName: string;
  defaultButlerId: string | null;
  activationId: string;
  activationEnabledAt: string;
  stageInstanceId: string | null;
  stageCode: string;
  stageName: string;
  materialTemplateId: string;
  templateKey: string;
  materialTypeId: string;
  materialTypeCode: string;
  title: string;
  requirement: string | null;
  requirementKind: "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
  deadlineRule: "ACTIVATION_OFFSET" | "STAGE_OFFSET" | "FIXED_DATE";
  deadlineOffsetDays: number | null;
  fixedDueAt: string | null;
  conditionRule: Prisma.JsonValue | null;
  conditionMatched: boolean;
  dueAt: string | null;
}

interface MaterialBackfillPlan {
  sopVersion: { id: string; versionNo: number };
  candidates: MaterialBackfillCandidate[];
  fingerprint: string;
}

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

        const [source, latest, materialTypes] = await Promise.all([
          transaction.sopVersion.findFirst({
            where: { status: "PUBLISHED" },
            include: SOP_INCLUDE,
          }),
          transaction.sopVersion.aggregate({ _max: { versionNo: true } }),
          transaction.materialType.findMany({
            where: { isActive: true },
            orderBy: [{ sequenceNo: "asc" }, { name: "asc" }],
          }),
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
              materials: {
                create: stage.materials.map((material) => ({
                  templateKey: material.templateKey,
                  materialTypeId: material.materialTypeId,
                  title: material.title,
                  requirement: material.requirement,
                  requirementKind: material.requirementKind,
                  deadlineRule: material.deadlineRule,
                  deadlineOffsetDays: material.deadlineOffsetDays,
                  fixedDueAt: material.fixedDueAt,
                  conditionRule: material.conditionRule ?? undefined,
                  sequenceNo: material.sequenceNo,
                })),
              },
            }))
          : BASELINE_STAGES.map(([stageCode, name], index) => ({
              stageCode,
              name,
              sequenceNo: index + 1,
              description: null,
              tasks: { create: [] },
              materials: {
                create:
                  stageCode === "MATERIALS"
                    ? materialTypes.map((materialType, materialIndex) => ({
                        materialTypeId: materialType.id,
                        title: materialType.name,
                        requirement: materialType.description,
                        requirementKind: materialType.isCore
                          ? ("REQUIRED" as const)
                          : ("OPTIONAL" as const),
                        deadlineRule:
                          materialType.collectionPhase === "CURRENT"
                            ? ("ACTIVATION_OFFSET" as const)
                            : ("STAGE_OFFSET" as const),
                        deadlineOffsetDays: 7,
                        sequenceNo: materialIndex + 1,
                      }))
                    : [],
              },
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
              materialCount: created.stages.reduce(
                (total, stage) => total + stage.materials.length,
                0,
              ),
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
            create: body.stages.map((stage, stageIndex) => {
              const stageCode = stage.stageCode.trim().toUpperCase();
              const existingStage = existing!.stages.find(
                (candidate) => candidate.stageCode === stageCode,
              );
              const materials =
                stage.materials ??
                existingStage?.materials.map((material) => ({
                  templateKey: material.templateKey,
                  materialTypeId: material.materialTypeId,
                  title: material.title,
                  requirement: material.requirement,
                  requirementKind: material.requirementKind,
                  deadlineRule: material.deadlineRule,
                  deadlineOffsetDays: material.deadlineOffsetDays,
                  fixedDueAt: material.fixedDueAt?.toISOString() ?? null,
                  conditionRule: material.conditionRule as Record<string, unknown> | null,
                })) ??
                [];
              return {
                stageCode,
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
                materials: {
                  create: materials.map((material, materialIndex) => ({
                    templateKey: material.templateKey,
                    materialTypeId: material.materialTypeId,
                    title: material.title.trim(),
                    requirement: this.optionalText(material.requirement),
                    requirementKind: material.requirementKind,
                    deadlineRule: material.deadlineRule,
                    deadlineOffsetDays:
                      material.deadlineRule === "FIXED_DATE" ? null : material.deadlineOffsetDays,
                    fixedDueAt:
                      material.deadlineRule === "FIXED_DATE" && material.fixedDueAt
                        ? new Date(material.fixedDueAt)
                        : null,
                    conditionRule:
                      material.requirementKind === "CONDITIONAL" && material.conditionRule
                        ? (material.conditionRule as Prisma.InputJsonObject)
                        : undefined,
                    sequenceNo: materialIndex + 1,
                  })),
                },
              };
            }),
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
      materialCount: version.stages.reduce((total, stage) => total + stage.materials.length, 0),
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

  public async previewMaterialBackfill(versionId: string, body: PreviewSopMaterialBackfillDto) {
    return this.serializeMaterialBackfillPlan(
      await this.buildMaterialBackfillPlan(this.prisma, versionId, body.studentIds),
    );
  }

  public async applyMaterialBackfill(
    versionId: string,
    body: ApplySopMaterialBackfillDto,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const plan = await this.buildMaterialBackfillPlan(
            transaction,
            versionId,
            body.studentIds,
          );
          if (plan.fingerprint !== body.previewFingerprint) {
            throw new ApiException(
              HttpStatus.CONFLICT,
              ErrorCode.SOP_VERSION_CONFLICT,
              "补发范围已变化，请重新预览后再确认",
              { currentFingerprint: plan.fingerprint },
            );
          }

          let taskCount = 0;
          for (const candidate of plan.candidates) {
            const material = await transaction.materialItem.create({
              data: {
                studentId: candidate.studentId,
                materialTypeId: candidate.materialTypeId,
                sopMaterialTemplateId: candidate.materialTemplateId,
                templateKeySnapshot: candidate.templateKey,
                title: candidate.title,
                requirement: candidate.requirement,
                origin: "SOP_TEMPLATE",
                requirementKind: candidate.requirementKind,
                deadlineRule: candidate.deadlineRule,
                deadlineOffsetDays: candidate.deadlineOffsetDays,
                fixedDueAtSnapshot: candidate.fixedDueAt ? new Date(candidate.fixedDueAt) : null,
                conditionRuleSnapshot:
                  candidate.conditionRule === null
                    ? undefined
                    : (candidate.conditionRule as Prisma.InputJsonValue),
                conditionMatched: candidate.conditionMatched,
                dueAt: candidate.dueAt ? new Date(candidate.dueAt) : null,
                ownerId: candidate.defaultButlerId,
                createdById: actor.id,
                status: candidate.conditionMatched ? "REQUIRED" : "NOT_APPLICABLE",
              },
            });
            if (
              !candidate.stageInstanceId ||
              !candidate.dueAt ||
              !candidate.conditionMatched ||
              candidate.requirementKind === "OPTIONAL"
            ) {
              continue;
            }
            const dueAt = new Date(candidate.dueAt);
            const completionWindowHours = Math.max(
              1,
              Math.ceil(
                (dueAt.getTime() - new Date(candidate.activationEnabledAt).getTime()) /
                  (60 * 60 * 1000),
              ),
            );
            const task = await transaction.taskInstance.create({
              data: {
                studentId: candidate.studentId,
                serviceActivationId: candidate.activationId,
                stageInstanceId: candidate.stageInstanceId,
                sopVersionId: versionId,
                sourceType: "MATERIAL",
                sourceObjectId: material.id,
                isBlockingSnapshot: true,
                externalVisible: true,
                createdById: actor.id,
                titleSnapshot: `收集并审核：${candidate.title}`,
                descriptionSnapshot: candidate.requirement,
                completionCriteriaSnapshot: "资料已审核通过，或已记录不适用原因",
                completionWindowHoursSnapshot: completionWindowHours,
                ownerId: candidate.defaultButlerId,
                originalDueAt: dueAt,
                currentDueAt: dueAt,
              },
            });
            await transaction.taskTimelineEvent.create({
              data: {
                taskId: task.id,
                eventType: "CREATED",
                actorId: actor.id,
                actorRole: actor.roles[0] ?? null,
                summary: `管理员从 SOP v${plan.sopVersion.versionNo}增量补发资料任务`,
                afterData: {
                  materialId: material.id,
                  materialTemplateId: candidate.materialTemplateId,
                  templateKey: candidate.templateKey,
                },
              },
            });
            taskCount += 1;
          }

          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "SOP_MATERIAL_BACKFILL_APPLIED",
              objectId: versionId,
              afterData: {
                versionNo: plan.sopVersion.versionNo,
                previewFingerprint: plan.fingerprint,
                studentCount: new Set(plan.candidates.map((candidate) => candidate.studentId)).size,
                materialCount: plan.candidates.length,
                taskCount,
                templateKeys: [
                  ...new Set(plan.candidates.map((candidate) => candidate.templateKey)),
                ],
              },
              reason: "管理员预览并确认后，仅补发既有学生缺少的SOP资料项",
            }),
          });
          return {
            sopVersionId: versionId,
            versionNo: plan.sopVersion.versionNo,
            previewFingerprint: plan.fingerprint,
            studentCount: new Set(plan.candidates.map((candidate) => candidate.studentId)).size,
            materialCount: plan.candidates.length,
            taskCount,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (this.isUniqueConstraintError(error) || this.isTransactionConflict(error)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SOP_VERSION_CONFLICT,
          "补发范围已被其他操作更新，请重新预览",
        );
      }
      throw error;
    }
  }

  private async buildMaterialBackfillPlan(
    client: MaterialBackfillClient,
    versionId: string,
    studentIds?: string[],
  ): Promise<MaterialBackfillPlan> {
    const normalizedStudentIds = studentIds
      ? [...new Set(studentIds)].sort((left, right) => left.localeCompare(right))
      : undefined;
    const version = await client.sopVersion.findUnique({
      where: { id: versionId },
      include: {
        stages: {
          orderBy: { sequenceNo: "asc" },
          include: {
            materials: {
              orderBy: { sequenceNo: "asc" },
              include: { materialType: true },
            },
          },
        },
      },
    });
    if (!version) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "SOP 版本不存在");
    }
    if (version.status !== "PUBLISHED") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SOP_IMMUTABLE,
        "只能使用当前已发布的SOP版本补发资料",
      );
    }

    const students = await client.student.findMany({
      where: {
        serviceStatus: "ENABLED",
        serviceActivation: { isNot: null },
        ...(normalizedStudentIds ? { id: { in: normalizedStudentIds } } : {}),
      },
      select: {
        id: true,
        studentNo: true,
        name: true,
        cohortYear: true,
        grade: true,
        identityCategory: true,
        examCandidateType: true,
        targetDirection: true,
        dseSubjects: true,
        defaultButlerId: true,
        serviceActivation: {
          select: {
            id: true,
            enabledAt: true,
            stages: {
              select: { id: true, stageCodeSnapshot: true, startedAt: true },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 501,
    });
    if (students.length > 500) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "单次最多预览500名学生，请指定学生范围分批补发",
      );
    }
    const existingItems =
      students.length === 0
        ? []
        : await client.materialItem.findMany({
            where: {
              studentId: { in: students.map((student) => student.id) },
              templateKeySnapshot: { not: null },
            },
            select: { studentId: true, templateKeySnapshot: true },
          });
    const existingKeys = new Set(
      existingItems.map((item) => `${item.studentId}:${item.templateKeySnapshot}`),
    );
    const candidates: MaterialBackfillCandidate[] = [];
    for (const student of students) {
      const activation = student.serviceActivation;
      if (!activation) continue;
      for (const stage of version.stages) {
        const stageInstance = activation.stages.find(
          (candidate) => candidate.stageCodeSnapshot === stage.stageCode,
        );
        for (const template of stage.materials) {
          if (existingKeys.has(`${student.id}:${template.templateKey}`)) continue;
          const conditionMatched =
            template.requirementKind !== "CONDITIONAL" ||
            matchesMaterialCondition(template.conditionRule, student);
          const dueAt = calculateMaterialDueAt({
            rule: template.deadlineRule,
            offsetDays: template.deadlineOffsetDays,
            fixedDueAt: template.fixedDueAt,
            activationAt: activation.enabledAt,
            stageStartedAt: stageInstance?.startedAt ?? null,
          });
          candidates.push({
            studentId: student.id,
            studentNo: student.studentNo,
            studentName: student.name,
            defaultButlerId: student.defaultButlerId,
            activationId: activation.id,
            activationEnabledAt: activation.enabledAt.toISOString(),
            stageInstanceId: stageInstance?.id ?? null,
            stageCode: stage.stageCode,
            stageName: stage.name,
            materialTemplateId: template.id,
            templateKey: template.templateKey,
            materialTypeId: template.materialTypeId,
            materialTypeCode: template.materialType.code,
            title: template.title,
            requirement: template.requirement,
            requirementKind: template.requirementKind,
            deadlineRule: template.deadlineRule,
            deadlineOffsetDays: template.deadlineOffsetDays,
            fixedDueAt: template.fixedDueAt?.toISOString() ?? null,
            conditionRule: template.conditionRule,
            conditionMatched,
            dueAt: dueAt?.toISOString() ?? null,
          });
        }
      }
    }
    candidates.sort((left, right) =>
      `${left.studentId}:${left.templateKey}`.localeCompare(
        `${right.studentId}:${right.templateKey}`,
      ),
    );
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          versionId,
          scope: normalizedStudentIds ?? "ALL_ENABLED_STUDENTS",
          candidates,
        }),
      )
      .digest("hex");
    return {
      sopVersion: { id: version.id, versionNo: version.versionNo },
      candidates,
      fingerprint,
    };
  }

  private serializeMaterialBackfillPlan(plan: MaterialBackfillPlan) {
    const students = new Map<
      string,
      {
        id: string;
        studentNo: string;
        name: string;
        materialCount: number;
        materials: Array<{
          templateKey: string;
          title: string;
          materialTypeCode: string;
          stageCode: string;
          stageName: string;
          requirementKind: MaterialBackfillCandidate["requirementKind"];
          conditionMatched: boolean;
          dueAt: string | null;
          taskWillBeCreated: boolean;
        }>;
      }
    >();
    for (const candidate of plan.candidates) {
      const student = students.get(candidate.studentId) ?? {
        id: candidate.studentId,
        studentNo: candidate.studentNo,
        name: candidate.studentName,
        materialCount: 0,
        materials: [],
      };
      student.materialCount += 1;
      student.materials.push({
        templateKey: candidate.templateKey,
        title: candidate.title,
        materialTypeCode: candidate.materialTypeCode,
        stageCode: candidate.stageCode,
        stageName: candidate.stageName,
        requirementKind: candidate.requirementKind,
        conditionMatched: candidate.conditionMatched,
        dueAt: candidate.dueAt,
        taskWillBeCreated:
          Boolean(candidate.stageInstanceId && candidate.dueAt && candidate.conditionMatched) &&
          candidate.requirementKind !== "OPTIONAL",
      });
      students.set(candidate.studentId, student);
    }
    return {
      sopVersionId: plan.sopVersion.id,
      versionNo: plan.sopVersion.versionNo,
      previewFingerprint: plan.fingerprint,
      studentCount: students.size,
      materialCount: plan.candidates.length,
      students: [...students.values()],
      guarantees: {
        additiveOnly: true,
        overwritesExistingItems: false,
        deletesExistingItems: false,
      },
    };
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
    const templateKeys = body.stages.flatMap((stage) =>
      (stage.materials ?? []).flatMap((material) =>
        material.templateKey ? [material.templateKey] : [],
      ),
    );
    if (new Set(templateKeys).size !== templateKeys.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "资料模板标识不能重复",
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
      if (stage.materials) {
        const materialTypeIds = stage.materials.map((material) => material.materialTypeId);
        if (new Set(materialTypeIds).size !== materialTypeIds.length) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            `${stage.name}中资料类型不能重复`,
          );
        }
        for (const material of stage.materials) {
          this.assertMaterialTemplateShape(material, stage.name);
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
    const materialTypeIds = version.stages.flatMap((stage) =>
      stage.materials.map((material) => material.materialTypeId),
    );
    if (new Set(materialTypeIds).size !== materialTypeIds.length) {
      errors.push({
        path: "stages.materials.materialTypeId",
        message: "同一 SOP 版本中每种资料类型只能配置一次",
      });
    }
    if (materialTypeIds.length === 0) {
      errors.push({ path: "stages.materials", message: "SOP 至少需要配置一项资料模板" });
    }
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
      for (const material of stage.materials) {
        if (!material.title.trim()) {
          errors.push({
            path: `materials.${material.id}.title`,
            message: `${stage.name}存在未命名资料模板`,
          });
        }
        if (
          material.deadlineRule === "FIXED_DATE"
            ? !material.fixedDueAt || material.deadlineOffsetDays !== null
            : material.deadlineOffsetDays === null ||
              material.deadlineOffsetDays < 0 ||
              material.fixedDueAt !== null
        ) {
          errors.push({
            path: `materials.${material.id}.deadlineRule`,
            message: `${material.title || "未命名资料"}的截止时间规则不完整`,
          });
        }
        if (
          material.requirementKind === "CONDITIONAL" &&
          !parseMaterialConditionRule(material.conditionRule)
        ) {
          errors.push({
            path: `materials.${material.id}.conditionRule`,
            message: `${material.title || "未命名资料"}缺少有效的条件必交规则`,
          });
        }
      }
    }
    return errors;
  }

  private serialize(version: SopWithContent) {
    const taskCount = version.stages.reduce((total, stage) => total + stage.tasks.length, 0);
    const materialCount = version.stages.reduce(
      (total, stage) => total + stage.materials.length,
      0,
    );
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
      materialCount,
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
        materials: stage.materials.map((material) => ({
          id: material.id,
          templateKey: material.templateKey,
          materialType: material.materialType,
          title: material.title,
          requirement: material.requirement,
          requirementKind: material.requirementKind,
          deadlineRule: material.deadlineRule,
          deadlineOffsetDays: material.deadlineOffsetDays,
          fixedDueAt: material.fixedDueAt?.toISOString() ?? null,
          conditionRule: material.conditionRule,
          sequenceNo: material.sequenceNo,
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
      materialCount: version.stages.reduce((total, stage) => total + stage.materials.length, 0),
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

  private assertMaterialTemplateShape(
    material: {
      templateKey?: string;
      title: string;
      requirementKind: "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
      deadlineRule: "ACTIVATION_OFFSET" | "STAGE_OFFSET" | "FIXED_DATE";
      deadlineOffsetDays?: number | null;
      fixedDueAt?: string | null;
      conditionRule?: Record<string, unknown> | null;
    },
    stageName: string,
  ) {
    if (!material.title.trim()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        `${stageName}中资料名称不能为空`,
      );
    }
    if (material.deadlineRule === "FIXED_DATE") {
      if (!material.fixedDueAt) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          `${material.title}必须填写固定截止时间`,
        );
      }
    } else if (
      material.deadlineOffsetDays === null ||
      material.deadlineOffsetDays === undefined ||
      !Number.isInteger(material.deadlineOffsetDays) ||
      material.deadlineOffsetDays < 0
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        `${material.title}必须填写非负整数天数`,
      );
    }
    if (
      material.requirementKind === "CONDITIONAL" &&
      !parseMaterialConditionRule(material.conditionRule)
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        `${material.title}必须配置有效的条件必交规则`,
      );
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    );
  }

  private isTransactionConflict(error: unknown) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2034"
    );
  }
}
