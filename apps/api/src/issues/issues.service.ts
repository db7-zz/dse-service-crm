import { ErrorCode, PermissionCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type {
  ConvertIssueToTaskDto,
  CreateIssueDto,
  IssueActionDto,
  ListIssuesQueryDto,
  RespondIssueDto,
} from "./issues.dto.js";

const ISSUE_INCLUDE = {
  student: {
    select: { id: true, studentNo: true, name: true, defaultButlerId: true, plannerId: true },
  },
  submittedBy: { select: { id: true, displayName: true } },
  linkedTask: { select: { id: true, titleSnapshot: true, status: true } },
  convertedTask: {
    select: { id: true, titleSnapshot: true, status: true, ownerId: true, currentDueAt: true },
  },
  logs: {
    include: { operator: { select: { id: true, displayName: true } } },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

@Injectable()
export class IssuesService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  public async list(query: ListIssuesQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const canManage = actor.permissions.includes(PermissionCode.ISSUES_MANAGE);
    const where: Prisma.IssueWhereInput = {
      ...(canManage
        ? {}
        : actor.roles.includes(RoleCode.SPECIALIST)
          ? { convertedTask: { ownerId: actor.id } }
          : { student: this.access.scopeFor(actor) }),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.issue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.issue.count({ where }),
    ]);
    return { items: items.map((item) => this.serialize(item)), page, pageSize, total };
  }

  public async detail(issueId: string, request: RequestContext) {
    return this.serialize(await this.loadAccessible(issueId, request));
  }

  public async create(body: CreateIssueDto, request: RequestContext) {
    await this.access.assertInternalAccess(body.studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      if (body.linkedTaskId) {
        const task = await transaction.taskInstance.findFirst({
          where: { id: body.linkedTaskId, studentId: body.studentId },
          select: { id: true },
        });
        if (!task) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "关联任务不属于该学生",
          );
        }
      }
      const issue = await transaction.issue.create({
        data: {
          studentId: body.studentId,
          linkedTaskId: body.linkedTaskId ?? null,
          category: body.category.trim(),
          description: body.description.trim(),
          context: body.context.trim(),
          priority: this.optionalText(body.priority),
          submittedById: actor.id,
          logs: {
            create: { action: "CREATED", note: body.description.trim(), operatorId: actor.id },
          },
        },
        include: ISSUE_INCLUDE,
      });
      const managers = await transaction.user.findMany({
        where: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.ADMINISTRATOR } } },
        },
        select: { id: true },
      });
      for (const manager of managers) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: manager.id,
          eventType: "ISSUE_SUBMITTED",
          title: `${issue.student.name}有新的问题反馈`,
          content: `${issue.category} · ${issue.description}`,
          objectType: "issue",
          objectId: issue.id,
          actionUrl: `/workspace/issues?issueId=${issue.id}`,
          eventKey: `issue-submitted:${issue.id}:${manager.id}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, issue.id, "ISSUE_SUBMITTED", {
          studentId: body.studentId,
          category: body.category.trim(),
          linkedTaskId: body.linkedTaskId ?? null,
        }),
      });
      return this.serialize(issue);
    });
  }

  public async addInformation(issueId: string, body: IssueActionDto, request: RequestContext) {
    const issue = await this.loadAccessible(issueId, request);
    this.assertVersion(issue.version, body.version);
    if (["CLOSED", "RESOLVED"].includes(issue.status)) {
      throw this.stateConflict("已关闭或解决的问题不能继续补充");
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.prisma.$transaction([
      this.prisma.issue.update({
        where: { id: issue.id },
        data: { status: "OPEN", version: { increment: 1 } },
      }),
      this.prisma.issueLog.create({
        data: {
          issueId: issue.id,
          action: "INFORMATION_ADDED",
          note: body.note.trim(),
          operatorId: actor.id,
        },
      }),
      this.prisma.auditLog.create({
        data: this.audit(request, issue.id, "ISSUE_INFORMATION_ADDED", {
          note: body.note.trim(),
        }),
      }),
    ]);
    return this.serialize(
      await this.prisma.issue.findUniqueOrThrow({
        where: { id: issue.id },
        include: ISSUE_INCLUDE,
      }),
    );
  }

  public async respond(issueId: string, body: RespondIssueDto, request: RequestContext) {
    const issue = await this.loadAccessible(issueId, request, true);
    this.assertVersion(issue.version, body.version);
    if (["CLOSED", "RESOLVED"].includes(issue.status)) throw this.stateConflict("问题已关闭");
    const actor = request.authenticatedUser as AuthenticatedUser;
    const status = body.requestMoreInformation ? "NEEDS_INFO" : "RESPONDED";
    await this.prisma.$transaction(async (transaction) => {
      await transaction.issue.update({
        where: { id: issue.id },
        data: {
          status,
          managerResponse: body.note.trim(),
          respondedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.issueLog.create({
        data: {
          issueId: issue.id,
          action: body.requestMoreInformation ? "INFORMATION_REQUESTED" : "RESPONDED",
          note: body.note.trim(),
          operatorId: actor.id,
        },
      });
      await this.notifications.createInTransaction(transaction, {
        recipientId: issue.submittedById,
        eventType: "ISSUE_SUBMITTED",
        title: `问题反馈已有${body.requestMoreInformation ? "补充要求" : "回复"}`,
        content: body.note.trim(),
        objectType: "issue",
        objectId: issue.id,
        actionUrl: `/workspace/issues?issueId=${issue.id}`,
        eventKey: `issue-response:${issue.id}:${body.version}:${issue.submittedById}`,
      });
      await transaction.auditLog.create({
        data: this.audit(request, issue.id, "ISSUE_RESPONDED", {
          status,
          note: body.note.trim(),
        }),
      });
    });
    return this.serialize(
      await this.prisma.issue.findUniqueOrThrow({
        where: { id: issue.id },
        include: ISSUE_INCLUDE,
      }),
    );
  }

  public async convertToTask(
    issueId: string,
    body: ConvertIssueToTaskDto,
    request: RequestContext,
  ) {
    const issue = await this.loadAccessible(issueId, request, true);
    this.assertVersion(issue.version, body.version);
    if (issue.convertedTaskId) throw this.stateConflict("该问题已经转化为专项任务");
    const dueAt = new Date(body.dueAt);
    if (dueAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "专项任务截止时间必须晚于当前时间",
      );
    }
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      const specialist = await transaction.user.findFirst({
        where: {
          id: body.ownerId,
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.SPECIALIST } } },
        },
        select: { id: true, displayName: true },
      });
      if (!specialist) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.RESPONSIBLE_PERSON_INVALID,
          "专项任务负责人必须是启用状态的专项老师",
        );
      }
      const activation = await transaction.studentServiceActivation.findUnique({
        where: { studentId: issue.studentId },
      });
      if (!activation) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.SERVICE_NOT_ENABLED,
          "学生尚未启用服务，不能创建专项任务",
        );
      }
      const stage = body.stageInstanceId
        ? await transaction.stageInstance.findFirst({
            where: { id: body.stageInstanceId, serviceActivationId: activation.id },
          })
        : await transaction.stageInstance.findUnique({
            where: {
              id: activation.currentStageInstanceId ?? "00000000-0000-0000-0000-000000000000",
            },
          });
      if (!stage) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          "当前没有可承载专项任务的服务阶段",
        );
      }
      const task = await transaction.taskInstance.create({
        data: {
          studentId: issue.studentId,
          serviceActivationId: activation.id,
          stageInstanceId: stage.id,
          sopVersionId: activation.sopVersionId,
          sourceType: "ISSUE",
          sourceObjectId: issue.id,
          isBlockingSnapshot: false,
          evidenceRequiredSnapshot: body.evidenceRequired,
          externalVisible: false,
          createdById: actor.id,
          titleSnapshot: `专项处理：${issue.category}`,
          descriptionSnapshot: `${issue.description}\n\n背景：${issue.context}`,
          completionCriteriaSnapshot: body.note.trim(),
          ownerId: specialist.id,
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
          summary: "问题反馈已转化为专项任务",
          afterData: { issueId: issue.id },
        },
      });
      await transaction.issue.update({
        where: { id: issue.id },
        data: {
          convertedTaskId: task.id,
          status: "CONVERTED_TO_TASK",
          managerResponse: body.note.trim(),
          respondedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await transaction.issueLog.create({
        data: {
          issueId: issue.id,
          action: "CONVERTED_TO_TASK",
          note: body.note.trim(),
          operatorId: actor.id,
        },
      });
      await this.notifications.createInTransaction(transaction, {
        recipientId: specialist.id,
        eventType: "SPECIALIST_TASK_ASSIGNED",
        title: "收到新的专项任务",
        content: `${issue.student.name} · ${issue.category}`,
        objectType: "task",
        objectId: task.id,
        actionUrl: `/workspace/tasks/${task.id}`,
        eventKey: `specialist-task:${task.id}:${specialist.id}`,
      });
      await transaction.auditLog.create({
        data: this.audit(request, issue.id, "ISSUE_CONVERTED_TO_TASK", {
          taskId: task.id,
          specialistId: specialist.id,
          dueAt: dueAt.toISOString(),
        }),
      });
      return { issueId: issue.id, taskId: task.id, owner: specialist };
    });
  }

  public async close(issueId: string, body: IssueActionDto, request: RequestContext) {
    return this.setClosedState(issueId, body, request, "CLOSED");
  }

  public async resolve(issueId: string, body: IssueActionDto, request: RequestContext) {
    return this.setClosedState(issueId, body, request, "RESOLVED");
  }

  public async reopen(issueId: string, body: IssueActionDto, request: RequestContext) {
    const issue = await this.loadAccessible(issueId, request);
    this.assertVersion(issue.version, body.version);
    if (!["CLOSED", "RESOLVED"].includes(issue.status))
      throw this.stateConflict("当前问题无需重新打开");
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.prisma.$transaction([
      this.prisma.issue.update({
        where: { id: issue.id },
        data: { status: "OPEN", closedAt: null, version: { increment: 1 } },
      }),
      this.prisma.issueLog.create({
        data: {
          issueId: issue.id,
          action: "REOPENED",
          note: body.note.trim(),
          operatorId: actor.id,
        },
      }),
      this.prisma.auditLog.create({
        data: this.audit(request, issue.id, "ISSUE_REOPENED", { note: body.note.trim() }),
      }),
    ]);
    return this.serialize(
      await this.prisma.issue.findUniqueOrThrow({
        where: { id: issue.id },
        include: ISSUE_INCLUDE,
      }),
    );
  }

  private async setClosedState(
    issueId: string,
    body: IssueActionDto,
    request: RequestContext,
    status: "CLOSED" | "RESOLVED",
  ) {
    const issue = await this.loadAccessible(issueId, request, true);
    this.assertVersion(issue.version, body.version);
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.prisma.$transaction([
      this.prisma.issue.update({
        where: { id: issue.id },
        data: { status, closedAt: new Date(), version: { increment: 1 } },
      }),
      this.prisma.issueLog.create({
        data: { issueId: issue.id, action: status, note: body.note.trim(), operatorId: actor.id },
      }),
      this.prisma.auditLog.create({
        data: this.audit(request, issue.id, `ISSUE_${status}`, { note: body.note.trim() }),
      }),
    ]);
    return this.serialize(
      await this.prisma.issue.findUniqueOrThrow({
        where: { id: issue.id },
        include: ISSUE_INCLUDE,
      }),
    );
  }

  private async loadAccessible(issueId: string, request: RequestContext, managementOnly = false) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      include: ISSUE_INCLUDE,
    });
    if (!issue)
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "问题不存在");
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (managementOnly && !actor.permissions.includes(PermissionCode.ISSUES_MANAGE)) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权处理该问题");
    }
    if (actor.permissions.includes(PermissionCode.ISSUES_MANAGE)) return issue;
    if (actor.roles.includes(RoleCode.SPECIALIST) && issue.convertedTask?.ownerId === actor.id)
      return issue;
    await this.access.assertInternalAccess(issue.studentId, request);
    return issue;
  }

  private serialize(issue: Prisma.IssueGetPayload<{ include: typeof ISSUE_INCLUDE }>) {
    return {
      id: issue.id,
      student: issue.student,
      linkedTask: issue.linkedTask
        ? {
            id: issue.linkedTask.id,
            title: issue.linkedTask.titleSnapshot,
            status: issue.linkedTask.status,
          }
        : null,
      convertedTask: issue.convertedTask
        ? {
            id: issue.convertedTask.id,
            title: issue.convertedTask.titleSnapshot,
            status: issue.convertedTask.status,
            dueAt: issue.convertedTask.currentDueAt.toISOString(),
          }
        : null,
      category: issue.category,
      description: issue.description,
      context: issue.context,
      priority: issue.priority,
      status: issue.status,
      submittedBy: issue.submittedBy,
      submittedAt: issue.submittedAt.toISOString(),
      managerResponse: issue.managerResponse,
      respondedAt: issue.respondedAt?.toISOString() ?? null,
      closedAt: issue.closedAt?.toISOString() ?? null,
      version: issue.version,
      logs: issue.logs.map((log) => ({
        id: log.id,
        action: log.action,
        note: log.note,
        operator: log.operator,
        createdAt: log.createdAt.toISOString(),
      })),
      updatedAt: issue.updatedAt.toISOString(),
    };
  }

  private assertVersion(currentVersion: number, submittedVersion: number) {
    if (currentVersion !== submittedVersion) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.ISSUE_VERSION_CONFLICT,
        "问题已被其他操作更新，请刷新后重试",
        { currentVersion },
      );
    }
  }

  private stateConflict(message: string) {
    return new ApiException(HttpStatus.CONFLICT, ErrorCode.ISSUE_STATE_CONFLICT, message);
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private audit(
    request: RequestContext,
    issueId: string,
    action: string,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: "issue",
      objectId: issueId,
      action,
      afterData,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
