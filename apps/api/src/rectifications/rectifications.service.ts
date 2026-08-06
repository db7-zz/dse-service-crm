import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type {
  CreateRectificationDto,
  ListRectificationsQueryDto,
  ReviewRectificationDto,
  SubmitRectificationDto,
} from "./rectifications.dto.js";

const RECTIFICATION_INCLUDE = {
  butler: { select: { id: true, displayName: true } },
  createdBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  items: {
    include: {
      task: {
        select: {
          id: true,
          titleSnapshot: true,
          status: true,
          currentDueAt: true,
          student: { select: { id: true, studentNo: true, name: true } },
        },
      },
      issue: {
        select: {
          id: true,
          category: true,
          description: true,
          status: true,
          dueAt: true,
          student: { select: { id: true, studentNo: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

@Injectable()
export class RectificationsService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(query: ListRectificationsQueryDto, butlerId?: string) {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const where: Prisma.RectificationRecordWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(butlerId ? { butlerId } : query.butlerId ? { butlerId: query.butlerId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.rectificationRecord.findMany({
        where,
        include: RECTIFICATION_INCLUDE,
        orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.rectificationRecord.count({ where }),
    ]);
    return { items: items.map((item) => this.serialize(item)), page, pageSize, total };
  }

  public listMine(query: ListRectificationsQueryDto, request: RequestContext) {
    return this.list(query, (request.authenticatedUser as AuthenticatedUser).id);
  }

  public async create(body: CreateRectificationDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const taskIds = [...new Set(body.taskIds)];
    const issueIds = [...new Set(body.issueIds)];
    if (taskIds.length + issueIds.length === 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "整改单至少需要关联一项可核验的异常",
      );
    }
    const dueAt = new Date(body.dueAt);
    if (dueAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "整改截止时间必须晚于当前时间",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const butler = await transaction.user.findFirst({
        where: {
          id: body.butlerId,
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.BUTLER } } },
        },
        select: { id: true, displayName: true },
      });
      if (!butler) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.RESPONSIBLE_PERSON_INVALID,
          "整改对象必须是启用状态的管家",
        );
      }
      const now = new Date();
      const tasks = await transaction.taskInstance.findMany({
        where: {
          id: { in: taskIds },
          ownerId: butler.id,
          status: { in: ["TODO", "IN_PROGRESS"] },
          currentDueAt: { lt: now },
        },
        select: { id: true, titleSnapshot: true },
      });
      const issues = await transaction.issue.findMany({
        where: {
          id: { in: issueIds },
          ownerId: butler.id,
          status: { notIn: ["RESOLVED", "CLOSED"] },
          dueAt: { lt: now },
        },
        select: { id: true, category: true, description: true },
      });
      if (tasks.length !== taskIds.length || issues.length !== issueIds.length) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          "部分关联事项已不属于该管家或不再处于超时状态，请刷新后重试",
        );
      }
      const record = await transaction.rectificationRecord.create({
        data: {
          butlerId: butler.id,
          createdById: actor.id,
          summary: body.summary.trim(),
          dueAt,
          items: {
            create: [
              ...tasks.map((task) => ({
                taskId: task.id,
                titleSnapshot: task.titleSnapshot,
              })),
              ...issues.map((issue) => ({
                issueId: issue.id,
                titleSnapshot: `${issue.category}：${issue.description}`.slice(0, 200),
              })),
            ],
          },
        },
        include: RECTIFICATION_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.audit(request, record.id, "RECTIFICATION_CREATED", {
          butlerId: butler.id,
          taskIds,
          issueIds,
          dueAt: dueAt.toISOString(),
        }),
      });
      return this.serialize(record);
    });
  }

  public async submit(id: string, body: SubmitRectificationDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const existing = await this.prisma.rectificationRecord.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "整改单不存在");
    }
    if (existing.butlerId !== actor.id) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "只能提交本人的整改单");
    }
    if (existing.status !== "PENDING_RECTIFICATION" || existing.version !== body.version) {
      throw this.stateConflict(existing.version);
    }
    const submittedAt = new Date();
    const changed = await this.prisma.rectificationRecord.updateMany({
      where: { id, status: "PENDING_RECTIFICATION", version: body.version },
      data: {
        status: "PENDING_REVIEW",
        responseNote: body.note.trim(),
        submittedAt,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw this.stateConflict(existing.version);
    await this.prisma.auditLog.create({
      data: this.audit(request, id, "RECTIFICATION_SUBMITTED", {
        submittedAt: submittedAt.toISOString(),
      }),
    });
    return this.detail(id);
  }

  public async review(id: string, body: ReviewRectificationDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const existing = await this.prisma.rectificationRecord.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "整改单不存在");
    }
    if (existing.status !== "PENDING_REVIEW" || existing.version !== body.version) {
      throw this.stateConflict(existing.version);
    }
    const reviewedAt = new Date();
    const status = body.approve ? "CLOSED" : "PENDING_RECTIFICATION";
    const changed = await this.prisma.rectificationRecord.updateMany({
      where: { id, status: "PENDING_REVIEW", version: body.version },
      data: {
        status,
        reviewNote: body.note.trim(),
        reviewedById: actor.id,
        reviewedAt,
        closedAt: body.approve ? reviewedAt : null,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw this.stateConflict(existing.version);
    await this.prisma.auditLog.create({
      data: this.audit(
        request,
        id,
        body.approve ? "RECTIFICATION_CLOSED" : "RECTIFICATION_RETURNED",
        { note: body.note.trim() },
      ),
    });
    return this.detail(id);
  }

  private async detail(id: string) {
    return this.serialize(
      await this.prisma.rectificationRecord.findUniqueOrThrow({
        where: { id },
        include: RECTIFICATION_INCLUDE,
      }),
    );
  }

  private stateConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.CONFLICT,
      "整改单状态已发生变化，请刷新后重试",
      { currentVersion },
    );
  }

  private serialize(
    record: Prisma.RectificationRecordGetPayload<{ include: typeof RECTIFICATION_INCLUDE }>,
  ) {
    return {
      id: record.id,
      butler: record.butler,
      createdBy: record.createdBy,
      summary: record.summary,
      dueAt: record.dueAt.toISOString(),
      status: record.status,
      responseNote: record.responseNote,
      submittedAt: record.submittedAt?.toISOString() ?? null,
      reviewNote: record.reviewNote,
      reviewedBy: record.reviewedBy,
      reviewedAt: record.reviewedAt?.toISOString() ?? null,
      closedAt: record.closedAt?.toISOString() ?? null,
      version: record.version,
      items: record.items.map((item) => ({
        id: item.id,
        title: item.titleSnapshot,
        type: item.taskId ? ("TASK" as const) : ("ISSUE" as const),
        task: item.task
          ? {
              id: item.task.id,
              title: item.task.titleSnapshot,
              status: item.task.status,
              dueAt: item.task.currentDueAt.toISOString(),
              student: item.task.student,
            }
          : null,
        issue: item.issue
          ? {
              id: item.issue.id,
              category: item.issue.category,
              status: item.issue.status,
              dueAt: item.issue.dueAt?.toISOString() ?? null,
              student: item.issue.student,
            }
          : null,
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private audit(
    request: RequestContext,
    objectId: string,
    action: string,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: "rectification",
      objectId,
      action,
      afterData,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
