import path from "node:path";
import { ConfigService } from "@nestjs/config";
import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type ApplicationStatus, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import type { Environment } from "../config/environment.js";
import { PRISMA } from "../database/database.module.js";
import { FileStorageService } from "../materials/file-storage.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type {
  AddApplicationActivityDto,
  AddApplicationEvidenceDto,
  ApplicationDashboardQueryDto,
  ChangeApplicationStatusDto,
  CreateApplicationDto,
  CreateApplicationRequirementDto,
  InvalidateApplicationActivityDto,
  ListApplicationsQueryDto,
  ReturnApplicationEvidenceDto,
  SetApplicationMaterialsDto,
  TransferApplicationOwnerDto,
  UpdateApplicationDto,
} from "./applications.dto.js";
import {
  APPLICATION_RISK_CODES,
  APPLICATION_STAGE_CODES,
  applicationAttention,
  applicationStage,
  compareAttention,
  relevantDeadline,
  type ApplicationAttention,
  type DashboardApplicationRecord,
} from "./applications-dashboard.js";

const ALLOWED_EVIDENCE_FILES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
};

const APPLICATION_INCLUDE = {
  student: {
    select: {
      id: true,
      studentNo: true,
      name: true,
      defaultButlerId: true,
      plannerId: true,
      portalUserId: true,
      materialItems: {
        where: { archiveStatus: "NOT_ARCHIVED" as const },
        select: {
          id: true,
          title: true,
          status: true,
          materialType: { select: { id: true, code: true, name: true, isCore: true } },
          currentVersion: {
            select: {
              id: true,
              versionNo: true,
              fileName: true,
              mimeType: true,
              fileSize: true,
              reviewStatus: true,
              uploadedAt: true,
            },
          },
        },
        orderBy: { title: "asc" as const },
      },
    },
  },
  owner: { select: { id: true, displayName: true } },
  statusLogs: {
    include: { operator: { select: { id: true, displayName: true } } },
    orderBy: { changedAt: "desc" as const },
  },
  requirements: {
    include: { linkedTask: { select: { id: true, titleSnapshot: true, status: true } } },
    orderBy: { createdAt: "desc" as const },
  },
  activities: {
    include: {
      operator: { select: { id: true, displayName: true } },
      invalidatedBy: { select: { id: true, displayName: true } },
      evidence: {
        include: { uploadedBy: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: "asc" as const },
      },
    },
    orderBy: { occurredAt: "desc" as const },
  },
  materialSnapshots: {
    include: {
      materialItem: { include: { materialType: true } },
      materialVersion: true,
      selectedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { selectedAt: "asc" as const },
  },
} as const;

const DASHBOARD_APPLICATION_SELECT = {
  id: true,
  studentId: true,
  channel: true,
  institutionName: true,
  programName: true,
  applicationNo: true,
  deadlineMode: true,
  deadlineAt: true,
  confirmationDeadline: true,
  status: true,
  updatedAt: true,
  student: { select: { id: true, studentNo: true, name: true } },
  owner: { select: { id: true, displayName: true } },
  requirements: {
    select: {
      id: true,
      requirementType: true,
      description: true,
      dueAt: true,
      status: true,
    },
  },
} as const;

const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PLANNING: ["CONFIRMED", "WITHDRAWN"],
  CONFIRMED: ["MATERIAL_PREPARATION", "PENDING_SUBMISSION", "WITHDRAWN"],
  MATERIAL_PREPARATION: ["PENDING_SUBMISSION", "WITHDRAWN"],
  PENDING_SUBMISSION: ["SUBMISSION_PENDING_EVIDENCE", "SUBMITTED", "WITHDRAWN"],
  SUBMISSION_PENDING_EVIDENCE: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: [
    "WAITING_RESULT",
    "SUPPLEMENT",
    "INTERVIEW",
    "WAITLISTED",
    "OFFER",
    "REJECTED",
    "WITHDRAWN",
  ],
  WAITING_RESULT: ["SUPPLEMENT", "INTERVIEW", "WAITLISTED", "OFFER", "REJECTED", "WITHDRAWN"],
  SUPPLEMENT: ["WAITING_RESULT", "INTERVIEW", "WAITLISTED", "OFFER", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["WAITING_RESULT", "WAITLISTED", "OFFER", "REJECTED", "WITHDRAWN"],
  WAITLISTED: ["OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["ENROLLED", "WITHDRAWN"],
  REJECTED: [],
  ENROLLED: [],
  WITHDRAWN: [],
};

@Injectable()
export class ApplicationsService {
  private readonly maxUploadBytes: number;

  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(FileStorageService) private readonly storage: FileStorageService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {
    this.maxUploadBytes = config.get("MAX_UPLOAD_BYTES", { infer: true });
  }

  public async list(query: ListApplicationsQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const search = query.search?.trim();
    const where: Prisma.ApplicationWhereInput = {
      student: this.access.scopeFor(actor),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.overdueOnly
        ? {
            deadlineAt: { lt: new Date() },
            status: {
              in: ["PLANNING", "CONFIRMED", "MATERIAL_PREPARATION", "PENDING_SUBMISSION"],
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { institutionName: { contains: search, mode: "insensitive" } },
              { programName: { contains: search, mode: "insensitive" } },
              { applicationNo: { contains: search, mode: "insensitive" } },
              { student: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.application.findMany({
        where,
        include: APPLICATION_INCLUDE,
        orderBy: [{ deadlineAt: "asc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.application.count({ where }),
    ]);
    return { items: items.map((item) => this.serialize(item)), page, pageSize, total };
  }

  public async dashboard(query: ApplicationDashboardQueryDto, request: RequestContext) {
    const now = new Date();
    const records = await this.loadDashboardApplications(query, request);
    const stageFiltered = query.stage
      ? records.filter((application) => applicationStage(application.status) === query.stage)
      : records;
    const riskFilteredForStages = query.risk
      ? records.filter((application) => applicationAttention(application, now)?.code === query.risk)
      : records;
    const visible = query.risk
      ? stageFiltered.filter(
          (application) => applicationAttention(application, now)?.code === query.risk,
        )
      : stageFiltered;
    const attentionItems = this.buildAttentionItems(visible, now);
    const studentItems = this.buildStudentSummaries(visible, now);
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const offset = (page - 1) * pageSize;

    return {
      summary: {
        risks: this.buildRiskSummary(stageFiltered, now),
        stages: this.buildStageSummary(riskFilteredForStages),
      },
      attention: {
        items: attentionItems.slice(0, 5),
        total: attentionItems.length,
      },
      students: {
        items: studentItems.slice(offset, offset + pageSize),
        page,
        pageSize,
        total: studentItems.length,
      },
      owners: this.ownerOptions(records),
    };
  }

  public async attention(query: ApplicationDashboardQueryDto, request: RequestContext) {
    const now = new Date();
    const records = await this.loadDashboardApplications(query, request);
    const visible = records.filter(
      (application) =>
        (!query.stage || applicationStage(application.status) === query.stage) &&
        (!query.risk || applicationAttention(application, now)?.code === query.risk),
    );
    const items = this.buildAttentionItems(visible, now);
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const offset = (page - 1) * pageSize;

    return {
      items: items.slice(offset, offset + pageSize),
      page,
      pageSize,
      total: items.length,
      owners: this.ownerOptions(records),
    };
  }

  public async detail(applicationId: string, request: RequestContext) {
    const application = await this.loadAccessible(applicationId, request);
    return this.serialize(application);
  }

  public async create(body: CreateApplicationDto, request: RequestContext) {
    const student = await this.access.assertInternalAccess(body.studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : null;
    if (body.deadlineMode === "FIXED" && !deadlineAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "已知截止时间时必须填写具体日期",
      );
    }
    if (body.deadlineMode !== "FIXED" && deadlineAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "滚动录取或暂未确认时不应填写固定截止日期",
      );
    }
    if (deadlineAt && deadlineAt.getTime() < Date.now() && !body.confirmPastDeadline) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        "申请截止时间早于当前时间，请确认后重新提交",
        { confirmationRequired: true },
      );
    }
    const duplicate = await this.prisma.application.findFirst({
      where: {
        studentId: body.studentId,
        channel: body.channel,
        institutionName: { equals: body.institutionName.trim(), mode: "insensitive" },
        roundName: this.optionalText(body.roundName),
        status: { not: "WITHDRAWN" },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.APPLICATION_DUPLICATE,
        "检测到相同学生、渠道、院校和专业的申请记录",
        { existingApplicationId: duplicate.id },
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const ownerId = body.ownerId ?? student.defaultButlerId;
      if (ownerId) await this.assertApplicationOwner(transaction, ownerId);
      const programChoices = this.cleanProgramChoices(body.programChoices, body.programName);
      const application = await transaction.application.create({
        data: {
          studentId: body.studentId,
          channel: body.channel,
          institutionName: body.institutionName.trim(),
          programName: programChoices[0] ?? this.optionalText(body.programName),
          programChoices,
          preferenceNo: body.preferenceNo ?? null,
          roundName: this.optionalText(body.roundName),
          deadlineAt,
          deadlineMode: body.deadlineMode,
          requestBasis: body.requestBasis.trim(),
          portalUrl: this.optionalText(body.portalUrl),
          ownerId,
          statusLogs: {
            create: {
              toStatus: "PLANNING",
              note: "创建申请记录",
              operatorId: actor.id,
            },
          },
          activities: {
            create: {
              activityType: "CREATED",
              note: `建立申请记录：${body.requestBasis.trim()}`,
              occurredAt: new Date(),
              operatorId: actor.id,
            },
          },
        },
        include: APPLICATION_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.audit(request, application.id, "APPLICATION_CREATED", {
          studentId: body.studentId,
          channel: body.channel,
          institutionName: body.institutionName.trim(),
          programName: body.programName ?? null,
          programChoices,
          deadlineMode: body.deadlineMode,
          requestBasis: body.requestBasis.trim(),
          ownerId,
        }),
      });
      return this.serialize(application);
    });
  }

  public async update(applicationId: string, body: UpdateApplicationDto, request: RequestContext) {
    const existing = await this.loadAccessible(applicationId, request);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (body.ownerId !== undefined && !actor.roles.includes(RoleCode.ADMINISTRATOR)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "只有管理员可以转交申请负责人",
      );
    }
    const nextDeadlineMode = body.deadlineMode ?? existing.deadlineMode;
    const nextDeadlineAt =
      body.deadlineAt === undefined
        ? existing.deadlineAt
        : body.deadlineAt
          ? new Date(body.deadlineAt)
          : null;
    if (nextDeadlineMode === "FIXED" && !nextDeadlineAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "已知截止时间时必须填写具体日期",
      );
    }
    if (nextDeadlineMode !== "FIXED" && nextDeadlineAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "滚动录取或暂未确认时不应填写固定截止日期",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      if (body.ownerId) await this.assertApplicationOwner(transaction, body.ownerId);
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: {
          ...(body.institutionName !== undefined
            ? { institutionName: body.institutionName.trim() }
            : {}),
          ...(body.programName !== undefined
            ? { programName: this.optionalText(body.programName) }
            : {}),
          ...(body.programChoices !== undefined
            ? {
                programChoices: this.cleanProgramChoices(body.programChoices, body.programName),
                programName:
                  this.cleanProgramChoices(body.programChoices, body.programName)[0] ?? null,
              }
            : {}),
          ...(body.preferenceNo !== undefined ? { preferenceNo: body.preferenceNo } : {}),
          ...(body.roundName !== undefined ? { roundName: this.optionalText(body.roundName) } : {}),
          ...(body.deadlineAt !== undefined
            ? { deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null }
            : {}),
          ...(body.deadlineMode !== undefined ? { deadlineMode: body.deadlineMode } : {}),
          ...(body.requestBasis !== undefined
            ? { requestBasis: this.optionalText(body.requestBasis) }
            : {}),
          ...(body.portalUrl !== undefined ? { portalUrl: this.optionalText(body.portalUrl) } : {}),
          ...(body.ownerId !== undefined ? { ownerId: body.ownerId } : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await transaction.application.findUniqueOrThrow({
          where: { id: applicationId },
        });
        throw this.versionConflict(current.version);
      }
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      await transaction.applicationStatusLog.create({
        data: {
          applicationId,
          fromStatus: existing.status,
          toStatus: existing.status,
          note: body.reason.trim(),
          beforeData: this.snapshot(existing),
          afterData: this.snapshot(updated),
          operatorId: actor.id,
        },
      });
      await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: "OTHER",
          note: body.reason.trim(),
          occurredAt: new Date(),
          operatorId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_UPDATED", {
          reason: body.reason.trim(),
          before: this.snapshot(existing),
          after: this.snapshot(updated),
        }),
      });
      return this.serialize(updated);
    });
  }

  public async changeStatus(
    applicationId: string,
    body: ChangeApplicationStatusDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    if (
      [
        "SUBMISSION_PENDING_EVIDENCE",
        "SUBMITTED",
        "WAITLISTED",
        "OFFER",
        "REJECTED",
        "ENROLLED",
      ].includes(body.status)
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "递交和正式结果必须通过操作留痕记录，并上传所需凭证",
      );
    }
    if (
      !actor.roles.includes(RoleCode.ADMINISTRATOR) &&
      !ALLOWED_TRANSITIONS[existing.status].includes(body.status)
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.APPLICATION_TRANSITION_INVALID,
        `申请不能从${existing.status}直接变更为${body.status}`,
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: {
          status: body.status,
          ...(body.submittedAt !== undefined
            ? { submittedAt: body.submittedAt ? new Date(body.submittedAt) : null }
            : {}),
          ...(body.applicationNo !== undefined
            ? { applicationNo: this.optionalText(body.applicationNo) }
            : {}),
          ...(body.result !== undefined ? { result: this.optionalText(body.result) } : {}),
          ...(body.offerCondition !== undefined
            ? { offerCondition: this.optionalText(body.offerCondition) }
            : {}),
          ...(body.confirmationDeadline !== undefined
            ? {
                confirmationDeadline: body.confirmationDeadline
                  ? new Date(body.confirmationDeadline)
                  : null,
              }
            : {}),
          ...(body.intakeDecision !== undefined
            ? { intakeDecision: this.optionalText(body.intakeDecision) }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await transaction.application.findUniqueOrThrow({
          where: { id: applicationId },
        });
        throw this.versionConflict(current.version);
      }
      await transaction.applicationStatusLog.create({
        data: {
          applicationId,
          fromStatus: existing.status,
          toStatus: body.status,
          note: body.note.trim(),
          beforeData: this.snapshot(existing),
          afterData: {
            status: body.status,
            submittedAt: body.submittedAt ?? null,
            applicationNo: body.applicationNo ?? null,
            result: body.result ?? null,
          },
          operatorId: actor.id,
        },
      });
      await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: "OTHER",
          note: body.note.trim(),
          occurredAt: new Date(),
          operatorId: actor.id,
          targetStatus: body.status,
          resultSnapshot: this.optionalText(body.result),
        },
      });
      const recipients = new Set(
        [existing.student.defaultButlerId, existing.ownerId].filter((value): value is string =>
          Boolean(value),
        ),
      );
      for (const recipientId of recipients) {
        await this.notifications.createInTransaction(transaction, {
          recipientId,
          eventType: "APPLICATION_STATUS_CHANGED",
          title: `${existing.student.name}的申请状态已更新`,
          content: `${existing.institutionName}${existing.programName ? ` · ${existing.programName}` : ""}：${body.status}`,
          objectType: "application",
          objectId: applicationId,
          actionUrl: `/workspace/applications/students/${existing.student.id}?applicationId=${applicationId}`,
          eventKey: `application-status:${applicationId}:${body.version}:${recipientId}`,
        });
      }
      if (body.status === "OFFER") {
        const existingConfirmation = await transaction.studentConfirmation.findFirst({
          where: {
            studentId: existing.student.id,
            objectType: "APPLICATION_OFFER",
            objectId: applicationId,
            status: "PENDING",
          },
          select: { id: true },
        });
        if (!existingConfirmation) {
          await transaction.studentConfirmation.create({
            data: {
              studentId: existing.student.id,
              objectType: "APPLICATION_OFFER",
              objectId: applicationId,
              prompt: `请确认是否接受 ${existing.institutionName}${existing.programName ? ` · ${existing.programName}` : ""} 的录取`,
              dueAt: body.confirmationDeadline ? new Date(body.confirmationDeadline) : null,
            },
          });
        }
      }
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_STATUS_CHANGED", {
          fromStatus: existing.status,
          toStatus: body.status,
          note: body.note.trim(),
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async addActivity(
    applicationId: string,
    body: AddApplicationActivityDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    const evidenceInput = this.decodeOptionalEvidence(body);
    if (body.activityType === "SUBMISSION_RECORDED" && !body.submittedAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "记录递交申请时必须填写实际递交时间",
      );
    }
    if (body.activityType === "RESULT_RECORDED") {
      if (!body.targetStatus || !body.result?.trim()) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          "记录正式结果时必须选择结果状态并填写结果摘要",
        );
      }
      if (!evidenceInput) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          "录取、拒绝、候补或入读等正式结果必须上传凭证",
        );
      }
    }
    if (body.activityType === "CORRECTION" && !body.correctionOfActivityId) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "更正记录必须关联原操作记录",
      );
    }
    if (body.correctionOfActivityId) {
      const corrected = await this.prisma.applicationActivity.findFirst({
        where: { id: body.correctionOfActivityId, applicationId },
        select: { id: true },
      });
      if (!corrected) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          "要更正的操作记录不存在",
        );
      }
    }

    const nextStatus = this.activityTargetStatus(
      existing.status,
      body,
      Boolean(evidenceInput),
      actor,
    );
    const stored = evidenceInput
      ? await this.storage.put({
          namespace: "application-evidence",
          ownerId: applicationId,
          fileName: evidenceInput.fileName,
          content: evidenceInput.content,
        })
      : null;

    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: {
          status: nextStatus,
          ...(body.activityType === "SUBMISSION_RECORDED"
            ? {
                submittedAt: new Date(body.submittedAt!),
                applicationNo: this.optionalText(body.applicationNo),
                portalUrl: this.optionalText(body.portalUrl) ?? existing.portalUrl,
              }
            : {}),
          ...(body.activityType === "RESULT_RECORDED"
            ? {
                result: body.result!.trim(),
                ...(body.offerCondition !== undefined
                  ? { offerCondition: this.optionalText(body.offerCondition) }
                  : {}),
                ...(body.confirmationDeadline !== undefined
                  ? {
                      confirmationDeadline: body.confirmationDeadline
                        ? new Date(body.confirmationDeadline)
                        : null,
                    }
                  : {}),
                ...(body.intakeDecision !== undefined
                  ? { intakeDecision: this.optionalText(body.intakeDecision) }
                  : {}),
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await transaction.application.findUniqueOrThrow({
          where: { id: applicationId },
        });
        throw this.versionConflict(current.version);
      }

      const activity = await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: body.activityType,
          note: body.note.trim(),
          occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
          operatorId: actor.id,
          studentVisible: body.studentVisible,
          portalUrl: this.optionalText(body.portalUrl),
          applicationNoSnapshot: this.optionalText(body.applicationNo),
          targetStatus: body.targetStatus ?? null,
          resultSnapshot: this.optionalText(body.result),
          correctionOfActivityId: body.correctionOfActivityId ?? null,
          ...(stored && evidenceInput
            ? {
                evidence: {
                  create: {
                    fileName: evidenceInput.fileName,
                    mimeType: evidenceInput.mimeType,
                    fileSize: evidenceInput.content.length,
                    storageKey: stored.storageKey,
                    fileHash: stored.fileHash,
                    uploadedById: actor.id,
                  },
                },
              }
            : {}),
        },
      });

      if (body.activityType === "SUBMISSION_RECORDED") {
        await transaction.applicationMaterialSnapshot.updateMany({
          where: { applicationId, frozenAt: null },
          data: { frozenAt: new Date() },
        });
      }
      if (nextStatus !== existing.status) {
        await transaction.applicationStatusLog.create({
          data: {
            applicationId,
            fromStatus: existing.status,
            toStatus: nextStatus,
            note: body.note.trim(),
            operatorId: actor.id,
            afterData: {
              activityId: activity.id,
              evidenceCount: evidenceInput ? 1 : 0,
              studentVisible: body.studentVisible,
            },
          },
        });
      }
      if (nextStatus === "OFFER") {
        await this.ensureOfferConfirmation(
          transaction,
          existing,
          applicationId,
          body.confirmationDeadline ? new Date(body.confirmationDeadline) : null,
        );
      }
      if (body.studentVisible && existing.student.portalUserId) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: existing.student.portalUserId,
          eventType: "APPLICATION_STATUS_CHANGED",
          title: `${existing.institutionName}申请动态`,
          content: body.note.trim(),
          objectType: "application",
          objectId: applicationId,
          actionUrl: "/portal/applications",
          eventKey: `application-activity:${activity.id}:${existing.student.portalUserId}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_ACTIVITY_ADDED", {
          activityId: activity.id,
          activityType: body.activityType,
          toStatus: nextStatus,
          evidenceCount: evidenceInput ? 1 : 0,
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async addEvidence(
    applicationId: string,
    activityId: string,
    body: AddApplicationEvidenceDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    const activity = existing.activities.find((item) => item.id === activityId);
    if (!activity || activity.invalidatedAt) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
        "申请操作记录不存在或已失效",
      );
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    const evidenceInput = this.decodeEvidence(body.fileName, body.mimeType, body.contentBase64);
    const stored = await this.storage.put({
      namespace: "application-evidence",
      ownerId: applicationId,
      fileName: evidenceInput.fileName,
      content: evidenceInput.content,
    });
    return this.prisma.$transaction(async (transaction) => {
      await transaction.applicationEvidence.create({
        data: {
          activityId,
          fileName: evidenceInput.fileName,
          mimeType: evidenceInput.mimeType,
          fileSize: evidenceInput.content.length,
          storageKey: stored.storageKey,
          fileHash: stored.fileHash,
          uploadedById: actor.id,
        },
      });
      const promoteSubmission =
        activity.activityType === "SUBMISSION_RECORDED" &&
        existing.status === "SUBMISSION_PENDING_EVIDENCE";
      const updateResult = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: {
          ...(promoteSubmission ? { status: "SUBMITTED" as const } : {}),
          version: { increment: 1 },
        },
      });
      if (updateResult.count !== 1) throw this.versionConflict(body.version + 1);
      if (promoteSubmission) {
        await transaction.applicationStatusLog.create({
          data: {
            applicationId,
            fromStatus: existing.status,
            toStatus: "SUBMITTED",
            note: "已补充递交凭证，转为正式已递交",
            operatorId: actor.id,
            afterData: { activityId },
          },
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_EVIDENCE_ADDED", {
          activityId,
          fileName: evidenceInput.fileName,
          promotedToSubmitted: promoteSubmission,
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async downloadEvidence(
    applicationId: string,
    activityId: string,
    evidenceId: string,
    request: RequestContext,
  ) {
    await this.loadAccessible(applicationId, request);
    const evidence = await this.prisma.applicationEvidence.findFirst({
      where: { id: evidenceId, activityId, activity: { applicationId } },
    });
    if (!evidence) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "申请凭证不存在");
    }
    await this.prisma.auditLog.create({
      data: this.audit(request, applicationId, "APPLICATION_EVIDENCE_DOWNLOADED", {
        activityId,
        evidenceId,
        fileName: evidence.fileName,
      }),
    });
    return {
      buffer: await this.storage.read(evidence.storageKey),
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
    };
  }

  public async setMaterials(
    applicationId: string,
    body: SetApplicationMaterialsDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    if (existing.submittedAt || existing.materialSnapshots.some((snapshot) => snapshot.frozenAt)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        "申请已发生外部递交，所用资料版本快照不能再修改",
      );
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    const uniqueIds = [...new Set(body.materialVersionIds)];
    const versions = await this.prisma.materialVersion.findMany({
      where: {
        id: { in: uniqueIds },
        materialItem: { studentId: existing.studentId, archiveStatus: "NOT_ARCHIVED" },
        reviewStatus: "APPROVED",
      },
      select: { id: true, materialItemId: true, materialItem: { select: { title: true } } },
    });
    if (versions.length !== uniqueIds.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "只能选择该学生已审核通过的资料版本",
      );
    }
    if (new Set(versions.map((version) => version.materialItemId)).size !== versions.length) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "同一资料项只能选择一个版本",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      await transaction.applicationMaterialSnapshot.deleteMany({
        where: {
          applicationId,
          materialVersionId: { notIn: uniqueIds },
          frozenAt: null,
        },
      });
      for (const version of versions) {
        await transaction.applicationMaterialSnapshot.upsert({
          where: {
            applicationId_materialItemId: {
              applicationId,
              materialItemId: version.materialItemId,
            },
          },
          create: {
            applicationId,
            materialItemId: version.materialItemId,
            materialVersionId: version.id,
            selectedById: actor.id,
          },
          update: {
            materialVersionId: version.id,
            selectedById: actor.id,
            selectedAt: new Date(),
          },
        });
      }
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: { version: { increment: 1 } },
      });
      if (result.count !== 1) throw this.versionConflict(body.version + 1);
      const activity = await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: "MATERIALS_UPDATED",
          note: versions.length
            ? `确认本次申请使用 ${versions.length} 份资料：${versions.map((item) => item.materialItem.title).join("、")}`
            : "清空本次申请所用资料",
          occurredAt: new Date(),
          operatorId: actor.id,
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_MATERIALS_UPDATED", {
          activityId: activity.id,
          materialVersionIds: uniqueIds,
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async returnEvidence(
    applicationId: string,
    activityId: string,
    body: ReturnApplicationEvidenceDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertAdministrator(actor);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    const activity = existing.activities.find(
      (item) => item.id === activityId && item.activityType === "SUBMISSION_RECORDED",
    );
    if (!activity) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "只能退回递交申请对应的凭证",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: { status: "SUBMISSION_PENDING_EVIDENCE", version: { increment: 1 } },
      });
      if (result.count !== 1) throw this.versionConflict(body.version + 1);
      const returnActivity = await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: "EVIDENCE_RETURNED",
          note: body.expectedBy
            ? `${body.reason.trim()}；期望补齐时间：${new Date(body.expectedBy).toLocaleString("zh-CN")}`
            : body.reason.trim(),
          occurredAt: new Date(),
          operatorId: actor.id,
          correctionOfActivityId: activityId,
        },
      });
      if (existing.status !== "SUBMISSION_PENDING_EVIDENCE") {
        await transaction.applicationStatusLog.create({
          data: {
            applicationId,
            fromStatus: existing.status,
            toStatus: "SUBMISSION_PENDING_EVIDENCE",
            note: `管理员退回补证：${body.reason.trim()}`,
            operatorId: actor.id,
            afterData: { activityId, returnActivityId: returnActivity.id },
          },
        });
      }
      if (existing.ownerId) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: existing.ownerId,
          eventType: "APPLICATION_STATUS_CHANGED",
          title: `${existing.student.name}的申请凭证被退回`,
          content: body.reason.trim(),
          objectType: "application",
          objectId: applicationId,
          actionUrl: `/workspace/applications/students/${existing.student.id}?applicationId=${applicationId}`,
          eventKey: `application-evidence-returned:${returnActivity.id}:${existing.ownerId}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_EVIDENCE_RETURNED", {
          activityId,
          returnActivityId: returnActivity.id,
          reason: body.reason.trim(),
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async invalidateActivity(
    applicationId: string,
    activityId: string,
    body: InvalidateApplicationActivityDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertAdministrator(actor);
    const activity = existing.activities.find((item) => item.id === activityId);
    if (!activity) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "操作记录不存在");
    }
    if (activity.invalidatedAt) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "操作记录已标记无效");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.applicationActivity.update({
        where: { id: activityId },
        data: {
          invalidatedAt: new Date(),
          invalidatedById: actor.id,
          invalidReason: body.reason.trim(),
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_ACTIVITY_INVALIDATED", {
          activityId,
          reason: body.reason.trim(),
        }),
      });
    });
    return this.detail(applicationId, request);
  }

  public async transferOwner(
    applicationId: string,
    body: TransferApplicationOwnerDto,
    request: RequestContext,
  ) {
    const existing = await this.loadAccessible(applicationId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertAdministrator(actor);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertApplicationOwner(transaction, body.ownerId);
      const result = await transaction.application.updateMany({
        where: { id: applicationId, version: body.version },
        data: { ownerId: body.ownerId, version: { increment: 1 } },
      });
      if (result.count !== 1) throw this.versionConflict(body.version + 1);
      const activity = await transaction.applicationActivity.create({
        data: {
          applicationId,
          activityType: "OWNER_TRANSFERRED",
          note: body.reason.trim(),
          occurredAt: new Date(),
          operatorId: actor.id,
        },
      });
      await this.notifications.createInTransaction(transaction, {
        recipientId: body.ownerId,
        eventType: "APPLICATION_STATUS_CHANGED",
        title: "收到转交的申请",
        content: `${existing.student.name} · ${existing.institutionName}`,
        objectType: "application",
        objectId: applicationId,
        actionUrl: `/workspace/applications/students/${existing.student.id}?applicationId=${applicationId}`,
        eventKey: `application-owner-transferred:${activity.id}:${body.ownerId}`,
      });
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_OWNER_TRANSFERRED", {
          activityId: activity.id,
          fromOwnerId: existing.ownerId,
          toOwnerId: body.ownerId,
          reason: body.reason.trim(),
        }),
      });
      const updated = await transaction.application.findUniqueOrThrow({
        where: { id: applicationId },
        include: APPLICATION_INCLUDE,
      });
      return this.serialize(updated);
    });
  }

  public async createRequirement(
    applicationId: string,
    body: CreateApplicationRequirementDto,
    request: RequestContext,
  ) {
    const application = await this.loadAccessible(applicationId, request);
    const dueAt = new Date(body.dueAt);
    if (dueAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "要求截止时间必须晚于当前时间",
      );
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      if (body.ownerId) await this.assertApplicationOwner(transaction, body.ownerId);
      const requirement = await transaction.applicationRequirement.create({
        data: {
          applicationId,
          requirementType: body.requirementType,
          description: body.description.trim(),
          dueAt,
        },
      });
      let linkedTaskId: string | null = null;
      if (body.createTask) {
        const task = await this.createRequirementTask(
          transaction,
          application,
          requirement.id,
          body,
          dueAt,
          actor,
        );
        linkedTaskId = task.id;
        await transaction.applicationRequirement.update({
          where: { id: requirement.id },
          data: { linkedTaskId },
        });
        if (task.ownerId) {
          await this.notifications.createInTransaction(transaction, {
            recipientId: task.ownerId,
            eventType:
              task.sourceType === "APPLICATION" ? "TASK_ASSIGNED" : "SPECIALIST_TASK_ASSIGNED",
            title: "收到新的申请节点任务",
            content: `${application.student.name} · ${body.description.trim()}`,
            objectType: "task",
            objectId: task.id,
            actionUrl: `/workspace/tasks/${task.id}`,
            eventKey: `application-requirement-task:${task.id}:${task.ownerId}`,
          });
        }
      }
      await transaction.auditLog.create({
        data: this.audit(request, applicationId, "APPLICATION_REQUIREMENT_CREATED", {
          requirementId: requirement.id,
          requirementType: body.requirementType,
          linkedTaskId,
        }),
      });
      return {
        id: requirement.id,
        requirementType: requirement.requirementType,
        description: requirement.description,
        dueAt: requirement.dueAt?.toISOString() ?? null,
        status: requirement.status,
        linkedTaskId,
      };
    });
  }

  private async createRequirementTask(
    transaction: Prisma.TransactionClient,
    application: Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>,
    requirementId: string,
    body: CreateApplicationRequirementDto,
    dueAt: Date,
    actor: AuthenticatedUser,
  ) {
    const activation = await transaction.studentServiceActivation.findUnique({
      where: { studentId: application.studentId },
    });
    if (!activation) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.SERVICE_NOT_ENABLED,
        "学生尚未启用服务，不能创建申请关联任务",
      );
    }
    const stageCode =
      body.requirementType === "ESSAY"
        ? "ESSAYS"
        : body.requirementType === "OTHER"
          ? "SUBMISSION"
          : "RESULTS";
    const stage = await transaction.stageInstance.findFirstOrThrow({
      where: { serviceActivationId: activation.id, stageCodeSnapshot: stageCode },
    });
    if (stage.status === "COMPLETED" && body.isBlocking) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.STAGE_ALREADY_COMPLETED,
        "已完成阶段不能新增阻塞申请任务",
      );
    }
    const ownerId = body.ownerId ?? application.ownerId ?? application.student.defaultButlerId;
    const task = await transaction.taskInstance.create({
      data: {
        studentId: application.studentId,
        serviceActivationId: activation.id,
        stageInstanceId: stage.id,
        sopVersionId: activation.sopVersionId,
        sourceType: "APPLICATION",
        sourceObjectId: application.id,
        isBlockingSnapshot: stage.status !== "COMPLETED" && body.isBlocking,
        externalVisible: true,
        createdById: actor.id,
        titleSnapshot: this.requirementTaskTitle(body.requirementType),
        descriptionSnapshot: body.description.trim(),
        completionCriteriaSnapshot: "完成申请节点要求并记录结果",
        ownerId,
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
        summary: "由申请节点要求创建任务",
        afterData: { applicationId: application.id, requirementId },
      },
    });
    return task;
  }

  private async loadDashboardApplications(
    query: ApplicationDashboardQueryDto,
    request: RequestContext,
  ): Promise<DashboardApplicationRecord[]> {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const search = query.search?.trim();
    return this.prisma.application.findMany({
      where: {
        student: this.access.scopeFor(actor),
        ...(query.ownerId ? { ownerId: query.ownerId } : {}),
        ...(query.channel ? { channel: query.channel } : {}),
        ...(search
          ? {
              OR: [
                { institutionName: { contains: search, mode: "insensitive" } },
                { programName: { contains: search, mode: "insensitive" } },
                { applicationNo: { contains: search, mode: "insensitive" } },
                { student: { name: { contains: search, mode: "insensitive" } } },
                { student: { studentNo: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      select: DASHBOARD_APPLICATION_SELECT,
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  private buildAttentionItems(records: DashboardApplicationRecord[], now: Date) {
    return records
      .map((application) => ({ application, attention: applicationAttention(application, now) }))
      .filter(
        (
          item,
        ): item is { application: DashboardApplicationRecord; attention: ApplicationAttention } =>
          Boolean(item.attention),
      )
      .sort((left, right) => {
        const attentionOrder = compareAttention(left.attention, right.attention);
        return (
          attentionOrder ||
          right.application.updatedAt.getTime() - left.application.updatedAt.getTime()
        );
      })
      .map(({ application, attention }) => ({
        ...this.serializeDashboardApplication(application),
        attention: this.serializeAttention(attention),
      }));
  }

  private buildStudentSummaries(records: DashboardApplicationRecord[], now: Date) {
    const grouped = new Map<string, DashboardApplicationRecord[]>();
    for (const application of records) {
      const current = grouped.get(application.studentId) ?? [];
      current.push(application);
      grouped.set(application.studentId, current);
    }

    return [...grouped.values()]
      .map((applications) => {
        const ordered = [...applications].sort((left, right) =>
          this.compareDashboardApplications(left, right, now),
        );
        const priorityApplication = ordered[0]!;
        const attention = applicationAttention(priorityApplication, now);
        const stageCounts = Object.fromEntries(
          APPLICATION_STAGE_CODES.map((stage) => [
            stage,
            applications.filter((application) => applicationStage(application.status) === stage)
              .length,
          ]),
        );
        return {
          student: priorityApplication.student,
          totalApplications: applications.length,
          attentionCount: applications.filter((application) =>
            Boolean(applicationAttention(application, now)),
          ).length,
          stageCounts,
          owners: this.ownerOptions(applications),
          priorityApplication: {
            ...this.serializeDashboardApplication(priorityApplication),
            attention: attention ? this.serializeAttention(attention) : null,
          },
        };
      })
      .sort((left, right) => {
        const leftAttention = left.priorityApplication.attention;
        const rightAttention = right.priorityApplication.attention;
        if (leftAttention && rightAttention && leftAttention.rank !== rightAttention.rank) {
          return leftAttention.rank - rightAttention.rank;
        }
        if (leftAttention && !rightAttention) return -1;
        if (!leftAttention && rightAttention) return 1;
        const leftDeadline = left.priorityApplication.effectiveDeadlineAt;
        const rightDeadline = right.priorityApplication.effectiveDeadlineAt;
        if (leftDeadline && rightDeadline) {
          return new Date(leftDeadline).getTime() - new Date(rightDeadline).getTime();
        }
        if (leftDeadline) return -1;
        if (rightDeadline) return 1;
        return left.student.name.localeCompare(right.student.name, "zh-CN");
      });
  }

  private compareDashboardApplications(
    left: DashboardApplicationRecord,
    right: DashboardApplicationRecord,
    now: Date,
  ) {
    const leftAttention = applicationAttention(left, now);
    const rightAttention = applicationAttention(right, now);
    if (leftAttention && rightAttention) {
      const attentionOrder = compareAttention(leftAttention, rightAttention);
      if (attentionOrder) return attentionOrder;
    } else if (leftAttention) {
      return -1;
    } else if (rightAttention) {
      return 1;
    }
    const leftDeadline = relevantDeadline(left);
    const rightDeadline = relevantDeadline(right);
    if (leftDeadline && rightDeadline) return leftDeadline.getTime() - rightDeadline.getTime();
    if (leftDeadline) return -1;
    if (rightDeadline) return 1;
    return right.updatedAt.getTime() - left.updatedAt.getTime();
  }

  private buildRiskSummary(records: DashboardApplicationRecord[], now: Date) {
    return Object.fromEntries(
      APPLICATION_RISK_CODES.map((risk) => {
        const matches = records.filter(
          (application) => applicationAttention(application, now)?.code === risk,
        );
        return [risk, this.summaryMetric(matches)];
      }),
    );
  }

  private buildStageSummary(records: DashboardApplicationRecord[]) {
    return Object.fromEntries(
      APPLICATION_STAGE_CODES.map((stage) => [
        stage,
        this.summaryMetric(
          records.filter((application) => applicationStage(application.status) === stage),
        ),
      ]),
    );
  }

  private summaryMetric(records: DashboardApplicationRecord[]) {
    return {
      applicationCount: records.length,
      studentCount: new Set(records.map((application) => application.studentId)).size,
    };
  }

  private ownerOptions(records: DashboardApplicationRecord[]) {
    return [
      ...new Map(
        records
          .filter(
            (
              application,
            ): application is DashboardApplicationRecord & {
              owner: { id: string; displayName: string };
            } => Boolean(application.owner),
          )
          .map((application) => [application.owner.id, application.owner]),
      ).values(),
    ].sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  }

  private serializeDashboardApplication(application: DashboardApplicationRecord) {
    return {
      id: application.id,
      student: application.student,
      channel: application.channel,
      institutionName: application.institutionName,
      programName: application.programName,
      applicationNo: application.applicationNo,
      deadlineAt: application.deadlineAt?.toISOString() ?? null,
      deadlineMode: application.deadlineMode,
      confirmationDeadline: application.confirmationDeadline?.toISOString() ?? null,
      effectiveDeadlineAt: relevantDeadline(application)?.toISOString() ?? null,
      status: application.status,
      stage: applicationStage(application.status),
      owner: application.owner,
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  private serializeAttention(attention: ApplicationAttention) {
    return {
      code: attention.code,
      rank: attention.rank,
      reason: attention.reason,
      deadlineAt: attention.deadlineAt?.toISOString() ?? null,
      daysRemaining: attention.daysRemaining,
    };
  }

  private async loadAccessible(applicationId: string, request: RequestContext) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "申请记录不存在");
    }
    await this.access.assertInternalAccess(application.studentId, request);
    return application;
  }

  private async assertApplicationOwner(transaction: Prisma.TransactionClient, userId: string) {
    const user = await transaction.user.findFirst({
      where: {
        id: userId,
        status: "ACTIVE",
        roles: {
          some: {
            expiredAt: null,
            role: { code: { in: [RoleCode.BUTLER, RoleCode.SPECIALIST] } },
          },
        },
      },
      select: { id: true },
    });
    if (!user) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RESPONSIBLE_PERSON_INVALID,
        "申请负责人必须是启用状态的管家或专项老师",
      );
    }
  }

  private serialize(
    application: Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>,
  ) {
    return {
      id: application.id,
      student: {
        id: application.student.id,
        studentNo: application.student.studentNo,
        name: application.student.name,
      },
      channel: application.channel,
      institutionName: application.institutionName,
      programName: application.programName,
      programChoices: application.programChoices,
      preferenceNo: application.preferenceNo,
      roundName: application.roundName,
      deadlineAt: application.deadlineAt?.toISOString() ?? null,
      deadlineMode: application.deadlineMode,
      requestBasis: application.requestBasis,
      portalUrl: application.portalUrl,
      status: application.status,
      submittedAt: application.submittedAt?.toISOString() ?? null,
      applicationNo: application.applicationNo,
      result: application.result,
      offerCondition: application.offerCondition,
      confirmationDeadline: application.confirmationDeadline?.toISOString() ?? null,
      owner: application.owner,
      intakeDecision: application.intakeDecision,
      version: application.version,
      isOverdue:
        Boolean(application.deadlineAt) &&
        application.deadlineAt!.getTime() < Date.now() &&
        ["PLANNING", "CONFIRMED", "MATERIAL_PREPARATION", "PENDING_SUBMISSION"].includes(
          application.status,
        ),
      statusLogs: application.statusLogs.map((log) => ({
        id: log.id,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        note: log.note,
        operator: log.operator,
        changedAt: log.changedAt.toISOString(),
      })),
      activities: application.activities.map((activity) => ({
        id: activity.id,
        activityType: activity.activityType,
        note: activity.note,
        occurredAt: activity.occurredAt.toISOString(),
        createdAt: activity.createdAt.toISOString(),
        operator: activity.operator,
        studentVisible: activity.studentVisible,
        portalUrl: activity.portalUrl,
        applicationNo: activity.applicationNoSnapshot,
        targetStatus: activity.targetStatus,
        result: activity.resultSnapshot,
        correctionOfActivityId: activity.correctionOfActivityId,
        invalidatedAt: activity.invalidatedAt?.toISOString() ?? null,
        invalidatedBy: activity.invalidatedBy,
        invalidReason: activity.invalidReason,
        evidence: activity.evidence.map((evidence) => ({
          id: evidence.id,
          fileName: evidence.fileName,
          mimeType: evidence.mimeType,
          fileSize: evidence.fileSize,
          uploadedBy: evidence.uploadedBy,
          createdAt: evidence.createdAt.toISOString(),
          downloadUrl: `/api/v1/applications/${application.id}/activities/${activity.id}/evidence/${evidence.id}/download`,
        })),
      })),
      availableMaterials: application.student.materialItems.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        materialType: item.materialType,
        currentVersion: item.currentVersion
          ? {
              id: item.currentVersion.id,
              versionNo: item.currentVersion.versionNo,
              fileName: item.currentVersion.fileName,
              mimeType: item.currentVersion.mimeType,
              fileSize: item.currentVersion.fileSize,
              reviewStatus: item.currentVersion.reviewStatus,
              uploadedAt: item.currentVersion.uploadedAt.toISOString(),
              downloadUrl: `/api/v1/materials/versions/${item.currentVersion.id}/download`,
            }
          : null,
      })),
      materialSnapshots: application.materialSnapshots.map((snapshot) => ({
        id: snapshot.id,
        materialItem: {
          id: snapshot.materialItem.id,
          title: snapshot.materialItem.title,
          materialType: {
            id: snapshot.materialItem.materialType.id,
            code: snapshot.materialItem.materialType.code,
            name: snapshot.materialItem.materialType.name,
            isCore: snapshot.materialItem.materialType.isCore,
          },
        },
        materialVersion: {
          id: snapshot.materialVersion.id,
          versionNo: snapshot.materialVersion.versionNo,
          fileName: snapshot.materialVersion.fileName,
          mimeType: snapshot.materialVersion.mimeType,
          fileSize: snapshot.materialVersion.fileSize,
          reviewStatus: snapshot.materialVersion.reviewStatus,
          uploadedAt: snapshot.materialVersion.uploadedAt.toISOString(),
          downloadUrl: `/api/v1/materials/versions/${snapshot.materialVersion.id}/download`,
        },
        selectedBy: snapshot.selectedBy,
        selectedAt: snapshot.selectedAt.toISOString(),
        frozenAt: snapshot.frozenAt?.toISOString() ?? null,
      })),
      requirements: application.requirements.map((requirement) => ({
        id: requirement.id,
        requirementType: requirement.requirementType,
        description: requirement.description,
        dueAt: requirement.dueAt?.toISOString() ?? null,
        status: requirement.status,
        linkedTask: requirement.linkedTask
          ? {
              id: requirement.linkedTask.id,
              title: requirement.linkedTask.titleSnapshot,
              status: requirement.linkedTask.status,
            }
          : null,
      })),
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
    };
  }

  private snapshot(application: {
    institutionName: string;
    programName: string | null;
    preferenceNo: number | null;
    roundName: string | null;
    deadlineAt: Date | null;
    status: ApplicationStatus;
    ownerId: string | null;
    version: number;
    deadlineMode: "FIXED" | "ROLLING" | "UNKNOWN";
    requestBasis: string | null;
    portalUrl: string | null;
    programChoices: string[];
  }): Prisma.InputJsonObject {
    return {
      institutionName: application.institutionName,
      programName: application.programName,
      programChoices: application.programChoices,
      preferenceNo: application.preferenceNo,
      roundName: application.roundName,
      deadlineAt: application.deadlineAt?.toISOString() ?? null,
      deadlineMode: application.deadlineMode,
      requestBasis: application.requestBasis,
      portalUrl: application.portalUrl,
      status: application.status,
      ownerId: application.ownerId,
      version: application.version,
    };
  }

  private activityTargetStatus(
    currentStatus: ApplicationStatus,
    body: AddApplicationActivityDto,
    hasEvidence: boolean,
    actor: AuthenticatedUser,
  ): ApplicationStatus {
    if (body.activityType === "SUBMISSION_RECORDED") {
      const allowed = [
        "PLANNING",
        "CONFIRMED",
        "MATERIAL_PREPARATION",
        "PENDING_SUBMISSION",
        "SUBMISSION_PENDING_EVIDENCE",
      ].includes(currentStatus);
      if (!allowed && !actor.roles.includes(RoleCode.ADMINISTRATOR)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.APPLICATION_TRANSITION_INVALID,
          "当前申请状态不能记录正式递交",
        );
      }
      return hasEvidence ? "SUBMITTED" : "SUBMISSION_PENDING_EVIDENCE";
    }
    if (body.activityType === "RESULT_RECORDED") {
      const target = body.targetStatus!;
      if (
        !actor.roles.includes(RoleCode.ADMINISTRATOR) &&
        !ALLOWED_TRANSITIONS[currentStatus].includes(target)
      ) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.APPLICATION_TRANSITION_INVALID,
          `申请不能从${currentStatus}直接变更为${target}`,
        );
      }
      return target;
    }
    return currentStatus;
  }

  private decodeOptionalEvidence(input: {
    fileName?: string;
    mimeType?: string;
    contentBase64?: string;
  }) {
    const supplied = [input.fileName, input.mimeType, input.contentBase64].filter(Boolean).length;
    if (supplied === 0) return null;
    if (supplied !== 3) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "上传凭证时必须同时提供文件名、文件类型和文件内容",
      );
    }
    return this.decodeEvidence(input.fileName!, input.mimeType!, input.contentBase64!);
  }

  private decodeEvidence(fileName: string, mimeType: string, contentBase64: string) {
    const extension = path.extname(fileName).toLowerCase();
    if (!ALLOWED_EVIDENCE_FILES[extension]?.includes(mimeType)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        "凭证仅支持 PDF、DOC、DOCX、JPG、JPEG 和 PNG 文件",
      );
    }
    const content = Buffer.from(contentBase64, "base64");
    if (content.length === 0 || content.length > this.maxUploadBytes) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        `文件不能为空且不得超过${Math.floor(this.maxUploadBytes / 1024 / 1024)}MB`,
      );
    }
    return { fileName, mimeType, content };
  }

  private cleanProgramChoices(values: string[] | undefined, fallback?: string | null) {
    const candidates = values?.length ? values : fallback ? [fallback] : [];
    return [...new Set(candidates.map((value) => value.trim()).filter(Boolean))];
  }

  private assertAdministrator(actor: AuthenticatedUser) {
    if (!actor.roles.includes(RoleCode.ADMINISTRATOR)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "只有管理员可以执行该监督操作",
      );
    }
  }

  private async ensureOfferConfirmation(
    transaction: Prisma.TransactionClient,
    application: Prisma.ApplicationGetPayload<{ include: typeof APPLICATION_INCLUDE }>,
    applicationId: string,
    dueAt: Date | null,
  ) {
    const existingConfirmation = await transaction.studentConfirmation.findFirst({
      where: {
        studentId: application.student.id,
        objectType: "APPLICATION_OFFER",
        objectId: applicationId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (existingConfirmation) return;
    await transaction.studentConfirmation.create({
      data: {
        studentId: application.student.id,
        objectType: "APPLICATION_OFFER",
        objectId: applicationId,
        prompt: `请确认是否接受 ${application.institutionName}${application.programName ? ` · ${application.programName}` : ""} 的录取`,
        dueAt,
      },
    });
  }

  private requirementTaskTitle(type: string) {
    return (
      {
        SUPPLEMENT: "完成申请补件",
        INTERVIEW: "准备申请面试",
        OFFER_CONFIRMATION: "确认录取与缴费",
        ESSAY: "完成申请文书",
        OTHER: "处理申请节点事项",
      }[type] ?? "处理申请节点事项"
    );
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.APPLICATION_VERSION_CONFLICT,
      "申请记录已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private audit(
    request: RequestContext,
    applicationId: string,
    action: string,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: "application",
      objectId: applicationId,
      action,
      afterData,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
