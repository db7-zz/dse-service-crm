import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type ApplicationStatus, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type {
  ChangeApplicationStatusDto,
  CreateApplicationDto,
  CreateApplicationRequirementDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from "./applications.dto.js";

const APPLICATION_INCLUDE = {
  student: {
    select: {
      id: true,
      studentNo: true,
      name: true,
      defaultButlerId: true,
      plannerId: true,
      portalUserId: true,
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
} as const;

const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  PLANNING: ["CONFIRMED", "WITHDRAWN"],
  CONFIRMED: ["MATERIAL_PREPARATION", "PENDING_SUBMISSION", "WITHDRAWN"],
  MATERIAL_PREPARATION: ["PENDING_SUBMISSION", "WITHDRAWN"],
  PENDING_SUBMISSION: ["SUBMITTED", "WITHDRAWN"],
  SUBMITTED: ["WAITING_RESULT", "SUPPLEMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  WAITING_RESULT: ["SUPPLEMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  SUPPLEMENT: ["WAITING_RESULT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"],
  INTERVIEW: ["WAITING_RESULT", "OFFER", "REJECTED", "WITHDRAWN"],
  OFFER: ["ENROLLED", "WITHDRAWN"],
  REJECTED: [],
  ENROLLED: [],
  WITHDRAWN: [],
};

@Injectable()
export class ApplicationsService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

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
            status: { notIn: ["SUBMITTED", "REJECTED", "ENROLLED", "WITHDRAWN"] },
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

  public async detail(applicationId: string, request: RequestContext) {
    const application = await this.loadAccessible(applicationId, request);
    return this.serialize(application);
  }

  public async create(body: CreateApplicationDto, request: RequestContext) {
    await this.access.assertInternalAccess(body.studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const deadlineAt = body.deadlineAt ? new Date(body.deadlineAt) : null;
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
        programName: this.optionalText(body.programName),
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
      if (body.ownerId) await this.assertApplicationOwner(transaction, body.ownerId);
      const application = await transaction.application.create({
        data: {
          studentId: body.studentId,
          channel: body.channel,
          institutionName: body.institutionName.trim(),
          programName: this.optionalText(body.programName),
          preferenceNo: body.preferenceNo ?? null,
          roundName: this.optionalText(body.roundName),
          deadlineAt,
          ownerId: body.ownerId ?? null,
          statusLogs: {
            create: {
              toStatus: "PLANNING",
              note: "创建申请记录",
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
        }),
      });
      return this.serialize(application);
    });
  }

  public async update(applicationId: string, body: UpdateApplicationDto, request: RequestContext) {
    const existing = await this.loadAccessible(applicationId, request);
    if (existing.version !== body.version) throw this.versionConflict(existing.version);
    const actor = request.authenticatedUser as AuthenticatedUser;
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
          ...(body.preferenceNo !== undefined ? { preferenceNo: body.preferenceNo } : {}),
          ...(body.roundName !== undefined ? { roundName: this.optionalText(body.roundName) } : {}),
          ...(body.deadlineAt !== undefined
            ? { deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : null }
            : {}),
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
      !actor.roles.includes(RoleCode.ADMINISTRATOR) &&
      !ALLOWED_TRANSITIONS[existing.status].includes(body.status)
    ) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.APPLICATION_TRANSITION_INVALID,
        `申请不能从${existing.status}直接变更为${body.status}`,
      );
    }
    if (body.status === "SUBMITTED" && !body.submittedAt) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "标记已提交时必须填写提交时间",
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
      const recipients = new Set(
        [existing.student.portalUserId, existing.student.defaultButlerId, existing.ownerId].filter(
          (value): value is string => Boolean(value),
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
          actionUrl:
            recipientId === existing.student.portalUserId
              ? "/portal/applications"
              : `/workspace/applications?applicationId=${applicationId}`,
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
      preferenceNo: application.preferenceNo,
      roundName: application.roundName,
      deadlineAt: application.deadlineAt?.toISOString() ?? null,
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
        !["SUBMITTED", "REJECTED", "ENROLLED", "WITHDRAWN"].includes(application.status),
      statusLogs: application.statusLogs.map((log) => ({
        id: log.id,
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        note: log.note,
        operator: log.operator,
        changedAt: log.changedAt.toISOString(),
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
  }): Prisma.InputJsonObject {
    return {
      institutionName: application.institutionName,
      programName: application.programName,
      preferenceNo: application.preferenceNo,
      roundName: application.roundName,
      deadlineAt: application.deadlineAt?.toISOString() ?? null,
      status: application.status,
      ownerId: application.ownerId,
      version: application.version,
    };
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
