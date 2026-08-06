import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type {
  ButlerSupervisionWeekQueryDto,
  RejectStudentBlockerDto,
  ReportStudentBlockerDto,
  ReviewWeeklyReviewDto,
  SubmitWeeklyReviewDto,
} from "./butler-supervision.dto.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const ACTIVE_TASK_STATUSES = ["TODO", "IN_PROGRESS"] as const;
const OPEN_ANOMALY_STATUSES = ["OPEN", "APPEAL_REJECTED"] as const;

export function hongKongWeekStart(value: Date): Date {
  const local = new Date(value.getTime() + HK_OFFSET_MS);
  const mondayOffset = (local.getUTCDay() + 6) % 7;
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - mondayOffset) -
      HK_OFFSET_MS,
  );
}

export function hongKongWeekEnd(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * DAY_MS - 1);
}

function hongKongDayKey(value: Date): string {
  return new Date(value.getTime() + HK_OFFSET_MS).toISOString().slice(0, 10);
}

function startOfHongKongDay(value: Date): Date {
  const local = new Date(value.getTime() + HK_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - HK_OFFSET_MS,
  );
}

const ANOMALY_INCLUDE = {
  butler: { select: { id: true, displayName: true } },
  task: {
    select: {
      id: true,
      titleSnapshot: true,
      status: true,
      currentDueAt: true,
      student: { select: { id: true, studentNo: true, name: true } },
    },
  },
  blocker: {
    select: {
      id: true,
      category: true,
      description: true,
      expectedRecoveryAt: true,
      reportedAt: true,
      reportedInTime: true,
      status: true,
      reviewNote: true,
    },
  },
} satisfies Prisma.ButlerAnomalyInclude;

const REVIEW_INCLUDE = {
  butler: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  items: {
    include: { anomaly: { include: ANOMALY_INCLUDE } },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.ButlerWeeklyReviewInclude;

@Injectable()
export class ButlerSupervisionService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async sync(now = new Date()) {
    const tasks = await this.prisma.taskInstance.findMany({
      where: {
        ownerId: { not: null },
        owner: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.BUTLER } } },
        },
      },
      select: {
        id: true,
        ownerId: true,
        titleSnapshot: true,
        status: true,
        currentDueAt: true,
        student: { select: { id: true, studentNo: true, name: true } },
        studentBlockers: {
          where: { status: "ACTIVE" },
          orderBy: { reportedAt: "desc" },
          take: 1,
        },
      },
    });
    const affectedButlers = new Set<string>();
    for (const task of tasks) {
      if (!task.ownerId) continue;
      const isActive = ACTIVE_TASK_STATUSES.includes(
        task.status as (typeof ACTIVE_TASK_STATUSES)[number],
      );
      if (!isActive) {
        await this.resolveTaskFacts(task.id, now);
        await this.prisma.taskStudentBlocker.updateMany({
          where: { taskId: task.id, status: "ACTIVE" },
          data: { status: "RESOLVED", resolvedAt: now },
        });
        continue;
      }
      if (task.currentDueAt >= now) continue;
      const blocker = task.studentBlockers[0];
      if (blocker?.reportedInTime && blocker.expectedRecoveryAt > now) continue;

      const anomaly = blocker?.reportedInTime
        ? {
            type: "STUDENT_BLOCKER_FOLLOWUP_MISSED" as const,
            sourceKey: `blocker-followup-missed:${blocker.id}:${blocker.expectedRecoveryAt.getTime()}`,
            title: "学生阻塞到期后未跟进",
            occurredAt: blocker.expectedRecoveryAt,
            blockerId: blocker.id,
            factDetail: {
              blockerCategory: blocker.category,
              blockerDescription: blocker.description,
              expectedRecoveryAt: blocker.expectedRecoveryAt.toISOString(),
            },
          }
        : {
            type: "TASK_OVERDUE_UNREPORTED" as const,
            sourceKey: `task-overdue-unreported:${task.id}:${task.currentDueAt.getTime()}`,
            title: "任务到期未完成且未按时上报阻塞",
            occurredAt: task.currentDueAt,
            blockerId: undefined,
            factDetail: {
              taskStatus: task.status,
              lateBlockerId: blocker?.id ?? null,
            },
          };
      const existing = await this.prisma.butlerAnomaly.findUnique({
        where: { sourceKey: anomaly.sourceKey },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.butlerAnomaly.create({
          data: {
            butlerId: task.ownerId,
            taskId: task.id,
            blockerId: anomaly.blockerId,
            type: anomaly.type,
            sourceKey: anomaly.sourceKey,
            titleSnapshot: anomaly.title,
            studentIdSnapshot: task.student.id,
            studentNoSnapshot: task.student.studentNo,
            studentNameSnapshot: task.student.name,
            deadlineSnapshot: task.currentDueAt,
            occurredAt: anomaly.occurredAt,
            factDetail: anomaly.factDetail,
          },
        });
        affectedButlers.add(task.ownerId);
      }
    }

    const currentWeekStart = hongKongWeekStart(now);
    await this.ensureWeek(currentWeekStart, false, now);
    await this.ensureWeek(new Date(currentWeekStart.getTime() - 7 * DAY_MS), true, now);
    await this.freezePastWeeks(currentWeekStart, now);
    await this.generateResponseOverdueFacts(now, affectedButlers);
    await this.notifyDailyAnomalies(affectedButlers, now);
    return { affectedButlers: affectedButlers.size };
  }

  public async dashboard(query: ButlerSupervisionWeekQueryDto) {
    const now = new Date();
    await this.sync(now);
    const requested = query.weekStart ? new Date(query.weekStart) : now;
    const weekStart = hongKongWeekStart(requested);
    const weekEnd = hongKongWeekEnd(weekStart);
    await this.ensureWeek(weekStart, weekEnd < now, now);

    const [butlers, anomalies, reviews, pendingBlockers] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.BUTLER } } },
        },
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" },
      }),
      this.anomaliesForWeek(weekStart, weekEnd),
      this.prisma.butlerWeeklyReview.findMany({
        where: { weekStart },
        include: REVIEW_INCLUDE,
      }),
      this.prisma.taskStudentBlocker.findMany({
        where: {
          status: "ACTIVE",
          reportedInTime: true,
          expectedRecoveryAt: { gt: now },
          task: {
            ownerId: { not: null },
            owner: {
              status: "ACTIVE",
              roles: { some: { expiredAt: null, role: { code: RoleCode.BUTLER } } },
            },
          },
        },
        include: {
          task: {
            select: {
              id: true,
              ownerId: true,
              titleSnapshot: true,
              currentDueAt: true,
              student: { select: { id: true, studentNo: true, name: true } },
            },
          },
        },
        orderBy: { expectedRecoveryAt: "asc" },
      }),
    ]);

    const reviewByButler = new Map(reviews.map((review) => [review.butlerId, review]));
    const items = butlers.map((butler) => {
      const rows = anomalies.filter((item) => item.butlerId === butler.id);
      const affectedStudents = new Map<string, { id: string; studentNo: string; name: string }>();
      for (const item of rows) {
        if (item.studentIdSnapshot && item.studentNoSnapshot && item.studentNameSnapshot) {
          affectedStudents.set(item.studentIdSnapshot, {
            id: item.studentIdSnapshot,
            studentNo: item.studentNoSnapshot,
            name: item.studentNameSnapshot,
          });
        }
      }
      const review = reviewByButler.get(butler.id);
      const verificationItems = pendingBlockers.filter(
        (blocker) => blocker.task.ownerId === butler.id,
      );
      return {
        ...butler,
        total: rows.length,
        newCount: rows.filter((item) => item.occurredAt >= weekStart).length,
        carriedCount: rows.filter((item) => item.occurredAt < weekStart).length,
        openCount: rows.filter((item) =>
          OPEN_ANOMALY_STATUSES.includes(item.status as (typeof OPEN_ANOMALY_STATUSES)[number]),
        ).length,
        oldestOccurredAt: rows[0]?.occurredAt.toISOString() ?? null,
        affectedStudents: Array.from(affectedStudents.values()),
        review: review ? this.serializeReview(review) : null,
        anomalies: rows.map((item) => this.serializeAnomaly(item)),
        pendingBlockers: verificationItems.map((blocker) => ({
          id: blocker.id,
          category: blocker.category,
          description: blocker.description,
          expectedRecoveryAt: blocker.expectedRecoveryAt.toISOString(),
          reportedAt: blocker.reportedAt.toISOString(),
          task: {
            id: blocker.task.id,
            title: blocker.task.titleSnapshot,
            currentDueAt: blocker.task.currentDueAt.toISOString(),
          },
          student: blocker.task.student,
        })),
      };
    });
    items.sort(
      (left, right) =>
        right.total - left.total || left.displayName.localeCompare(right.displayName),
    );

    const trend = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const start = new Date(weekStart.getTime() - offset * 7 * DAY_MS);
      const end = hongKongWeekEnd(start);
      const rows = await this.anomaliesForWeek(start, end);
      trend.push({
        weekStart: start.toISOString(),
        weekEnd: end.toISOString(),
        total: rows.length,
        newCount: rows.filter((item) => item.occurredAt >= start).length,
        carriedCount: rows.filter((item) => item.occurredAt < start).length,
      });
    }

    return {
      selectedWeek: {
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        frozen: weekEnd < now,
      },
      summary: {
        total: anomalies.length,
        newCount: anomalies.filter((item) => item.occurredAt >= weekStart).length,
        carriedCount: anomalies.filter((item) => item.occurredAt < weekStart).length,
        affectedButlerCount: new Set(anomalies.map((item) => item.butlerId)).size,
        pendingVerificationCount: pendingBlockers.length,
      },
      trend,
      items,
      generatedAt: now.toISOString(),
    };
  }

  public async reportStudentBlocker(
    taskId: string,
    body: ReportStudentBlockerDto,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const expectedRecoveryAt = new Date(body.expectedRecoveryAt);
    const now = new Date();
    if (expectedRecoveryAt <= now) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "预计恢复时间必须晚于当前时间",
      );
    }
    return this.prisma.$transaction(async (transaction) => {
      const task = await transaction.taskInstance.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          ownerId: true,
          status: true,
          currentDueAt: true,
          version: true,
          titleSnapshot: true,
        },
      });
      if (!task) {
        throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "任务不存在");
      }
      if (task.ownerId !== actor.id) {
        throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "只能上报本人负责的任务");
      }
      if (!ACTIVE_TASK_STATUSES.includes(task.status as (typeof ACTIVE_TASK_STATUSES)[number])) {
        throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "当前任务状态不能上报阻塞");
      }
      if (task.version !== body.version) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.TASK_VERSION_CONFLICT,
          "任务已更新，请刷新后重试",
          {
            currentVersion: task.version,
          },
        );
      }
      await transaction.taskStudentBlocker.updateMany({
        where: { taskId, status: "ACTIVE" },
        data: { status: "SUPERSEDED" },
      });
      const blocker = await transaction.taskStudentBlocker.create({
        data: {
          taskId,
          reportedById: actor.id,
          category: body.category,
          description: body.description.trim(),
          expectedRecoveryAt,
          reportedAt: now,
          reportedInTime: now <= task.currentDueAt,
        },
      });
      await transaction.taskInstance.update({
        where: { id: taskId },
        data: { version: { increment: 1 } },
      });
      await transaction.taskTimelineEvent.create({
        data: {
          taskId,
          eventType: "STUDENT_BLOCKER_REPORTED",
          actorId: actor.id,
          actorRole: actor.roles[0] ?? null,
          summary: blocker.reportedInTime ? "管家按时上报学生阻塞" : "管家逾期补充学生阻塞说明",
          reason: blocker.description,
          afterData: {
            blockerId: blocker.id,
            category: blocker.category,
            expectedRecoveryAt: blocker.expectedRecoveryAt.toISOString(),
            reportedInTime: blocker.reportedInTime,
          },
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, "student_blocker", blocker.id, "STUDENT_BLOCKER_REPORTED", {
          taskId,
          category: blocker.category,
          expectedRecoveryAt: blocker.expectedRecoveryAt.toISOString(),
          reportedInTime: blocker.reportedInTime,
        }),
      });
      return {
        id: blocker.id,
        taskId,
        category: blocker.category,
        description: blocker.description,
        expectedRecoveryAt: blocker.expectedRecoveryAt.toISOString(),
        reportedAt: blocker.reportedAt.toISOString(),
        reportedInTime: blocker.reportedInTime,
        status: blocker.status,
        taskVersion: body.version + 1,
      };
    });
  }

  public async rejectStudentBlocker(
    blockerId: string,
    body: RejectStudentBlockerDto,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const now = new Date();
    const blocker = await this.prisma.taskStudentBlocker.findUnique({
      where: { id: blockerId },
      include: {
        task: {
          select: {
            id: true,
            ownerId: true,
            titleSnapshot: true,
            currentDueAt: true,
            student: { select: { id: true, studentNo: true, name: true } },
          },
        },
      },
    });
    if (!blocker || !blocker.task.ownerId) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "阻塞记录不存在");
    }
    if (blocker.status !== "ACTIVE") {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "该阻塞记录已处理");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.taskStudentBlocker.update({
        where: { id: blocker.id },
        data: {
          status: "REJECTED",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewNote: body.note.trim(),
        },
      });
      await transaction.butlerAnomaly.upsert({
        where: { sourceKey: `student-blocker-rejected:${blocker.id}` },
        update: {},
        create: {
          butlerId: blocker.task.ownerId!,
          taskId: blocker.task.id,
          blockerId: blocker.id,
          type: "STUDENT_BLOCKER_REJECTED",
          sourceKey: `student-blocker-rejected:${blocker.id}`,
          titleSnapshot: "学生阻塞上报被管理员驳回",
          studentIdSnapshot: blocker.task.student.id,
          studentNoSnapshot: blocker.task.student.studentNo,
          studentNameSnapshot: blocker.task.student.name,
          deadlineSnapshot: blocker.task.currentDueAt,
          occurredAt: now,
          factDetail: { reviewNote: body.note.trim() },
        },
      });
      await transaction.taskTimelineEvent.create({
        data: {
          taskId: blocker.task.id,
          eventType: "STUDENT_BLOCKER_REJECTED",
          actorId: actor.id,
          actorRole: actor.roles[0] ?? null,
          summary: "管理员驳回学生阻塞上报",
          reason: body.note.trim(),
          afterData: { blockerId: blocker.id },
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, "student_blocker", blocker.id, "STUDENT_BLOCKER_REJECTED", {
          taskId: blocker.task.id,
          note: body.note.trim(),
        }),
      });
    });
    await this.sync(now);
    await this.notifyDailyAnomalies(new Set([blocker.task.ownerId]), now);
    return { id: blocker.id, status: "REJECTED" as const };
  }

  public async listMine(request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.sync();
    const reviews = await this.prisma.butlerWeeklyReview.findMany({
      where: { butlerId: actor.id },
      include: REVIEW_INCLUDE,
      orderBy: { weekStart: "desc" },
      take: 24,
    });
    return { items: reviews.map((review) => this.serializeReview(review)) };
  }

  public async submitReview(id: string, body: SubmitWeeklyReviewDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const review = await this.prisma.butlerWeeklyReview.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!review)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
        "周异常清单不存在",
      );
    if (review.butlerId !== actor.id) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "只能提交本人的周异常清单");
    }
    if (review.status !== "PENDING_RESPONSE" || review.version !== body.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        "周异常清单状态已变化，请刷新后重试",
      );
    }
    const expected = new Set(review.items.map((item) => item.anomalyId));
    if (
      body.items.length !== expected.size ||
      body.items.some((item) => !expected.has(item.anomalyId))
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "请逐项填写全部异常说明",
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      for (const item of body.items) {
        await transaction.butlerWeeklyReviewItem.update({
          where: { reviewId_anomalyId: { reviewId: id, anomalyId: item.anomalyId } },
          data: { responseNote: item.responseNote.trim(), respondedAt: now },
        });
      }
      await transaction.butlerWeeklyReview.update({
        where: { id },
        data: { status: "PENDING_REVIEW", submittedAt: now, version: { increment: 1 } },
      });
      const managers = await transaction.user.findMany({
        where: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.ADMINISTRATOR } } },
        },
        select: { id: true },
      });
      for (const manager of managers) {
        const eventKey = `weekly-review-submitted:${id}:${manager.id}`;
        await transaction.notification.upsert({
          where: { eventKey },
          update: {},
          create: {
            recipientId: manager.id,
            eventType: "BUTLER_WEEKLY_REVIEW_SUBMITTED",
            title: "管家已提交周异常说明",
            content: `${review.items.length} 项异常待复核`,
            objectType: "butler_weekly_review",
            objectId: id,
            actionUrl: "/workspace/butlers",
            eventKey,
          },
        });
      }
    });
    return this.reviewDetail(id);
  }

  public async reviewWeekly(id: string, body: ReviewWeeklyReviewDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const review = await this.prisma.butlerWeeklyReview.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!review)
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
        "周异常清单不存在",
      );
    if (review.status !== "PENDING_REVIEW" || review.version !== body.version) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        "周异常清单状态已变化，请刷新后重试",
      );
    }
    const expected = new Set(review.items.map((item) => item.anomalyId));
    if (
      body.items.length !== expected.size ||
      body.items.some((item) => !expected.has(item.anomalyId))
    ) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "请逐项给出复核结论",
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      for (const item of body.items) {
        await transaction.butlerAnomaly.update({
          where: { id: item.anomalyId },
          data: {
            status: item.decision,
            resolvedAt: item.decision === "APPEAL_REJECTED" ? null : now,
            resolvedById: actor.id,
            resolutionNote: body.note.trim(),
          },
        });
      }
      await transaction.butlerWeeklyReview.update({
        where: { id },
        data: {
          status: "CLOSED",
          reviewedById: actor.id,
          reviewedAt: now,
          reviewNote: body.note.trim(),
          version: { increment: 1 },
        },
      });
      await transaction.auditLog.create({
        data: this.audit(request, "butler_weekly_review", id, "BUTLER_WEEKLY_REVIEW_CLOSED", {
          note: body.note.trim(),
          decisions: body.items.map((item) => ({
            anomalyId: item.anomalyId,
            decision: item.decision,
          })),
        }),
      });
    });
    return this.reviewDetail(id);
  }

  private async reviewDetail(id: string) {
    return this.serializeReview(
      await this.prisma.butlerWeeklyReview.findUniqueOrThrow({
        where: { id },
        include: REVIEW_INCLUDE,
      }),
    );
  }

  private anomaliesForWeek(weekStart: Date, weekEnd: Date) {
    return this.prisma.butlerAnomaly.findMany({
      where: {
        occurredAt: { lte: weekEnd },
        OR: [{ resolvedAt: null }, { resolvedAt: { gte: weekStart } }],
      },
      include: ANOMALY_INCLUDE,
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    });
  }

  private async ensureWeek(weekStart: Date, frozen: boolean, now: Date) {
    const weekEnd = hongKongWeekEnd(weekStart);
    const anomalies = await this.anomaliesForWeek(weekStart, weekEnd);
    const byButler = new Map<string, typeof anomalies>();
    for (const anomaly of anomalies) {
      const rows = byButler.get(anomaly.butlerId) ?? [];
      rows.push(anomaly);
      byButler.set(anomaly.butlerId, rows);
    }
    for (const [butlerId, rows] of byButler) {
      const existingReview = await this.prisma.butlerWeeklyReview.findUnique({
        where: { butlerId_weekStart: { butlerId, weekStart } },
        select: { id: true },
      });
      const review = await this.prisma.butlerWeeklyReview.upsert({
        where: { butlerId_weekStart: { butlerId, weekStart } },
        update: {},
        create: {
          butlerId,
          weekStart,
          weekEnd,
          status: frozen ? "PENDING_RESPONSE" : "LIVE",
          frozenAt: frozen ? now : null,
          responseDueAt: frozen ? new Date(weekStart.getTime() + 10 * DAY_MS - 1) : null,
        },
      });
      await this.prisma.butlerWeeklyReviewItem.createMany({
        data: rows.map((item) => ({
          reviewId: review.id,
          anomalyId: item.id,
          itemKind: item.occurredAt >= weekStart ? "NEW" : "CARRIED",
        })),
        skipDuplicates: true,
      });
      if (frozen && !existingReview) {
        const eventKey = `weekly-review-frozen:${review.id}:${butlerId}`;
        await this.prisma.notification.upsert({
          where: { eventKey },
          update: {},
          create: {
            recipientId: butlerId,
            eventType: "BUTLER_WEEKLY_REVIEW_FROZEN",
            title: "上周异常清单已冻结",
            content: `${rows.length} 项异常，请在两个工作日内逐项说明`,
            objectType: "butler_weekly_review",
            objectId: review.id,
            actionUrl: "/workspace/my-tasks",
            eventKey,
          },
        });
      }
    }
  }

  private async freezePastWeeks(currentWeekStart: Date, now: Date) {
    const live = await this.prisma.butlerWeeklyReview.findMany({
      where: { status: "LIVE", weekStart: { lt: currentWeekStart } },
      include: { butler: { select: { displayName: true } }, items: { select: { id: true } } },
    });
    for (const review of live) {
      const responseDueAt = new Date(review.weekStart.getTime() + 10 * DAY_MS - 1);
      await this.prisma.butlerWeeklyReview.update({
        where: { id: review.id },
        data: {
          status: "PENDING_RESPONSE",
          frozenAt: now,
          responseDueAt,
          version: { increment: 1 },
        },
      });
      const eventKey = `weekly-review-frozen:${review.id}:${review.butlerId}`;
      await this.prisma.notification.upsert({
        where: { eventKey },
        update: {},
        create: {
          recipientId: review.butlerId,
          eventType: "BUTLER_WEEKLY_REVIEW_FROZEN",
          title: "上周异常清单已冻结",
          content: `${review.items.length} 项异常，请在两个工作日内逐项说明`,
          objectType: "butler_weekly_review",
          objectId: review.id,
          actionUrl: "/workspace/my-tasks",
          eventKey,
        },
      });
    }
  }

  private async generateResponseOverdueFacts(now: Date, affected: Set<string>) {
    const overdue = await this.prisma.butlerWeeklyReview.findMany({
      where: { status: "PENDING_RESPONSE", responseDueAt: { lt: now } },
      include: { butler: { select: { displayName: true } } },
    });
    for (const review of overdue) {
      const sourceKey = `weekly-response-overdue:${review.id}`;
      const existing = await this.prisma.butlerAnomaly.findUnique({
        where: { sourceKey },
        select: { id: true },
      });
      if (!existing) {
        await this.prisma.butlerAnomaly.create({
          data: {
            butlerId: review.butlerId,
            type: "WEEKLY_RESPONSE_OVERDUE",
            sourceKey,
            titleSnapshot: "周异常清单未在两个工作日内回复",
            occurredAt: review.responseDueAt ?? now,
            deadlineSnapshot: review.responseDueAt,
            factDetail: { weeklyReviewId: review.id, weekStart: review.weekStart.toISOString() },
          },
        });
        affected.add(review.butlerId);
      }
    }
  }

  private async resolveTaskFacts(taskId: string, now: Date) {
    await this.prisma.butlerAnomaly.updateMany({
      where: { taskId, status: { in: [...OPEN_ANOMALY_STATUSES] }, resolvedAt: null },
      data: {
        status: "RECTIFIED",
        resolvedAt: now,
        resolutionNote: "任务已结束，系统标记为已整改；原异常事实保留",
      },
    });
  }

  private async notifyDailyAnomalies(butlerIds: Set<string>, now: Date) {
    if (butlerIds.size === 0) return;
    const [managers, butlers] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.ADMINISTRATOR } } },
        },
        select: { id: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: Array.from(butlerIds) } },
        select: { id: true, displayName: true },
      }),
    ]);
    const dayStart = startOfHongKongDay(now);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    for (const butler of butlers) {
      const count = await this.prisma.butlerAnomaly.count({
        where: { butlerId: butler.id, createdAt: { gte: dayStart, lt: dayEnd } },
      });
      for (const manager of managers) {
        const eventKey = `butler-anomaly-daily:${butler.id}:${hongKongDayKey(now)}:${manager.id}`;
        await this.prisma.notification.upsert({
          where: { eventKey },
          update: {
            content: `${butler.displayName} 今日新增 ${count} 项异常，已合并到管家监督`,
          },
          create: {
            recipientId: manager.id,
            eventType: "BUTLER_ANOMALY_DAILY",
            title: "管家异常动态",
            content: `${butler.displayName} 今日新增 ${count} 项异常，已合并到管家监督`,
            objectType: "butler",
            objectId: butler.id,
            actionUrl: "/workspace/butlers",
            eventKey,
          },
        });
      }
    }
  }

  private serializeAnomaly(
    anomaly: Prisma.ButlerAnomalyGetPayload<{ include: typeof ANOMALY_INCLUDE }>,
  ) {
    return {
      id: anomaly.id,
      type: anomaly.type,
      status: anomaly.status,
      title: anomaly.titleSnapshot,
      occurredAt: anomaly.occurredAt.toISOString(),
      deadline: anomaly.deadlineSnapshot?.toISOString() ?? null,
      student:
        anomaly.studentIdSnapshot && anomaly.studentNoSnapshot && anomaly.studentNameSnapshot
          ? {
              id: anomaly.studentIdSnapshot,
              studentNo: anomaly.studentNoSnapshot,
              name: anomaly.studentNameSnapshot,
            }
          : null,
      task: anomaly.task
        ? {
            id: anomaly.task.id,
            title: anomaly.task.titleSnapshot,
            status: anomaly.task.status,
            currentDueAt: anomaly.task.currentDueAt.toISOString(),
          }
        : null,
      blocker: anomaly.blocker
        ? {
            ...anomaly.blocker,
            expectedRecoveryAt: anomaly.blocker.expectedRecoveryAt.toISOString(),
            reportedAt: anomaly.blocker.reportedAt.toISOString(),
          }
        : null,
      factDetail: anomaly.factDetail,
      resolvedAt: anomaly.resolvedAt?.toISOString() ?? null,
      resolutionNote: anomaly.resolutionNote,
      createdAt: anomaly.createdAt.toISOString(),
    };
  }

  private serializeReview(
    review: Prisma.ButlerWeeklyReviewGetPayload<{ include: typeof REVIEW_INCLUDE }>,
  ) {
    return {
      id: review.id,
      butler: review.butler,
      weekStart: review.weekStart.toISOString(),
      weekEnd: review.weekEnd.toISOString(),
      status: review.status,
      frozenAt: review.frozenAt?.toISOString() ?? null,
      responseDueAt: review.responseDueAt?.toISOString() ?? null,
      submittedAt: review.submittedAt?.toISOString() ?? null,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt?.toISOString() ?? null,
      reviewNote: review.reviewNote,
      version: review.version,
      items: review.items.map((item) => ({
        id: item.id,
        itemKind: item.itemKind,
        responseNote: item.responseNote,
        respondedAt: item.respondedAt?.toISOString() ?? null,
        anomaly: this.serializeAnomaly(item.anomaly),
      })),
    };
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
