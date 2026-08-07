import type { Prisma, PrismaClient } from "@dse/database";
import { RoleCode } from "@dse/shared";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PRISMA } from "../database/database.module.js";
import {
  AUTOMATED_DEADLINE_STATUSES,
  effectiveMaterialDeadline,
  overdueDeadlineMilestone,
  reviewSlaMilestone,
  upcomingDeadlineMilestone,
} from "./material-automation.logic.js";

export interface MaterialAutomationResult {
  dueSoonNotified: number;
  overdueNotified: number;
  reviewSlaNotified: number;
  failed: number;
}

type AutomatedNotification = Prisma.NotificationCreateManyInput & { eventKey: string };

const REVIEW_STATUSES = ["PENDING_REVIEW", "IN_REVIEW"] as const;

@Injectable()
export class MaterialAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaterialAutomationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<MaterialAutomationResult>;
  private lastStartedAt?: Date;
  private lastCompletedAt?: Date;
  private lastResult?: MaterialAutomationResult;
  private lastFailedAt?: Date;

  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public onModuleInit() {
    void this.scan().catch((error: unknown) => {
      this.logger.error("Initial material automation scan failed", error);
    });
    this.timer = setInterval(
      () => {
        void this.scan().catch((error: unknown) => {
          this.logger.error("Scheduled material automation scan failed", error);
        });
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }

  public onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  public status() {
    return {
      running: Boolean(this.running),
      lastStartedAt: this.lastStartedAt?.toISOString() ?? null,
      lastCompletedAt: this.lastCompletedAt?.toISOString() ?? null,
      lastFailedAt: this.lastFailedAt?.toISOString() ?? null,
      lastResult: this.lastResult ?? null,
    };
  }

  public scan() {
    if (!this.running) {
      this.lastStartedAt = new Date();
      this.running = this.performScan(this.lastStartedAt)
        .then((result) => {
          this.lastResult = result;
          this.lastCompletedAt = new Date();
          return result;
        })
        .catch((error: unknown) => {
          this.lastFailedAt = new Date();
          throw error;
        })
        .finally(() => {
          this.running = undefined;
        });
    }
    return this.running;
  }

  private async performScan(now: Date): Promise<MaterialAutomationResult> {
    const [materials, submissions, administrators] = await Promise.all([
      this.prisma.materialItem.findMany({
        where: {
          archiveStatus: "NOT_ARCHIVED",
          status: { in: [...AUTOMATED_DEADLINE_STATUSES] },
          OR: [{ dueAt: { not: null } }, { correctionDueAt: { not: null } }],
        },
        select: {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          correctionDueAt: true,
          expectedSubmitAt: true,
          ownerId: true,
          studentId: true,
          student: {
            select: {
              name: true,
              portalUserId: true,
              defaultButlerId: true,
            },
          },
        },
      }),
      this.prisma.materialSubmission.findMany({
        where: { status: { in: [...REVIEW_STATUSES] }, submittedAt: { not: null } },
        select: {
          id: true,
          submissionNo: true,
          source: true,
          submittedAt: true,
          reviewStartedById: true,
          materialItem: {
            select: {
              id: true,
              studentId: true,
              title: true,
              ownerId: true,
              student: { select: { name: true, defaultButlerId: true } },
            },
          },
        },
      }),
      this.prisma.user.findMany({
        where: {
          status: "ACTIVE",
          roles: { some: { expiredAt: null, role: { code: RoleCode.ADMINISTRATOR } } },
        },
        select: { id: true },
      }),
    ]);

    const administratorIds = administrators.map(({ id }) => id);
    const dueSoon = new Map<string, AutomatedNotification>();
    const overdue = new Map<string, AutomatedNotification>();
    const reviewSla = new Map<string, AutomatedNotification>();

    for (const material of materials) {
      const deadline = effectiveMaterialDeadline(material);
      if (!deadline) continue;
      const upcomingMilestone = upcomingDeadlineMilestone(deadline, now);
      const overdueMilestone = overdueDeadlineMilestone(deadline, now);
      const responsibleId = material.student.defaultButlerId ?? material.ownerId;
      const deadlineLabel = this.formatHongKongDate(deadline);

      if (upcomingMilestone) {
        if (material.student.portalUserId) {
          this.addNotification(dueSoon, {
            recipientId: material.student.portalUserId,
            eventType: "MATERIAL_DUE_SOON",
            title: `资料将在${upcomingMilestone}天内截止`,
            content: `${material.title} · 截止时间 ${deadlineLabel}`,
            objectType: "material",
            objectId: material.id,
            actionUrl: "/portal/materials",
            eventKey: this.deadlineEventKey(
              "due-soon",
              material.id,
              deadline,
              upcomingMilestone,
              material.student.portalUserId,
            ),
          });
        }
        if (responsibleId) {
          this.addNotification(dueSoon, {
            recipientId: responsibleId,
            eventType: "MATERIAL_DUE_SOON",
            title: `学生资料将在${upcomingMilestone}天内截止`,
            content: `${material.student.name} · ${material.title} · ${deadlineLabel}`,
            objectType: "material",
            objectId: material.id,
            actionUrl: `/workspace/materials?studentId=${material.studentId}`,
            eventKey: this.deadlineEventKey(
              "due-soon",
              material.id,
              deadline,
              upcomingMilestone,
              responsibleId,
            ),
          });
        }
      } else if (overdueMilestone !== null) {
        const overdueText = overdueMilestone === 0 ? "已逾期" : `已逾期${overdueMilestone}天`;
        if (material.student.portalUserId) {
          this.addNotification(overdue, {
            recipientId: material.student.portalUserId,
            eventType: "MATERIAL_OVERDUE",
            title: `资料${overdueText}`,
            content: `${material.title} · 原截止时间 ${deadlineLabel}`,
            objectType: "material",
            objectId: material.id,
            actionUrl: "/portal/materials",
            eventKey: this.deadlineEventKey(
              "overdue",
              material.id,
              deadline,
              overdueMilestone,
              material.student.portalUserId,
            ),
          });
        }
        const internalRecipients = new Set<string>();
        if (responsibleId) internalRecipients.add(responsibleId);
        if (overdueMilestone >= 3) administratorIds.forEach((id) => internalRecipients.add(id));
        for (const recipientId of internalRecipients) {
          this.addNotification(overdue, {
            recipientId,
            eventType: "MATERIAL_OVERDUE",
            title: `学生资料${overdueText}`,
            content: `${material.student.name} · ${material.title} · ${deadlineLabel}`,
            objectType: "material",
            objectId: material.id,
            actionUrl: `/workspace/materials?studentId=${material.studentId}`,
            eventKey: this.deadlineEventKey(
              "overdue",
              material.id,
              deadline,
              overdueMilestone,
              recipientId,
            ),
          });
        }
      }
    }

    for (const submission of submissions) {
      if (!submission.submittedAt) continue;
      const milestone = reviewSlaMilestone(submission.submittedAt, now);
      if (!milestone) continue;
      const recipients = new Set<string>();
      if (submission.reviewStartedById) {
        recipients.add(submission.reviewStartedById);
      } else if (submission.source === "BUTLER") {
        administratorIds.forEach((id) => recipients.add(id));
      } else {
        const responsibleId =
          submission.materialItem.student.defaultButlerId ?? submission.materialItem.ownerId;
        if (responsibleId) recipients.add(responsibleId);
      }
      if (milestone === 72) administratorIds.forEach((id) => recipients.add(id));

      for (const recipientId of recipients) {
        this.addNotification(reviewSla, {
          recipientId,
          eventType: "MATERIAL_REVIEW_OVERDUE",
          title: `资料审核已等待${milestone}小时`,
          content: `${submission.materialItem.student.name} · ${submission.materialItem.title} · 第${submission.submissionNo}批`,
          objectType: "material_submission",
          objectId: submission.id,
          actionUrl: `/workspace/materials?studentId=${submission.materialItem.studentId}`,
          eventKey: `material-review-sla:${submission.id}:${submission.submittedAt.getTime()}:${milestone}:${recipientId}`,
        });
      }
    }

    const result: MaterialAutomationResult = {
      dueSoonNotified: 0,
      overdueNotified: 0,
      reviewSlaNotified: 0,
      failed: 0,
    };
    result.dueSoonNotified = await this.persist("deadline", [...dueSoon.values()], result);
    result.overdueNotified = await this.persist("overdue", [...overdue.values()], result);
    result.reviewSlaNotified = await this.persist("review SLA", [...reviewSla.values()], result);
    return result;
  }

  private addNotification(
    target: Map<string, AutomatedNotification>,
    notification: AutomatedNotification,
  ) {
    target.set(notification.eventKey, notification);
  }

  private async persist(
    category: string,
    notifications: AutomatedNotification[],
    result: MaterialAutomationResult,
  ) {
    if (notifications.length === 0) return 0;
    try {
      const created = await this.prisma.notification.createMany({
        data: notifications,
        skipDuplicates: true,
      });
      return created.count;
    } catch (error) {
      result.failed += notifications.length;
      this.logger.error(`Material automation ${category} notifications failed`, error);
      return 0;
    }
  }

  private deadlineEventKey(
    kind: "due-soon" | "overdue",
    materialId: string,
    deadline: Date,
    milestone: number,
    recipientId: string,
  ) {
    return `material-${kind}:${materialId}:${deadline.getTime()}:${milestone}:${recipientId}`;
  }

  private formatHongKongDate(value: Date) {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Hong_Kong",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  }
}
