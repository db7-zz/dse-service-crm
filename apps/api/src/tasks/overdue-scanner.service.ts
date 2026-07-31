import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import type { PrismaClient } from "@dse/database";
import { PRISMA } from "../database/database.module.js";

const ACTIVE_STATUSES = ["TODO", "IN_PROGRESS"] as const;

@Injectable()
export class OverdueScannerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueScannerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<{ generated: number; resolved: number; failed: number }>;

  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public onModuleInit() {
    void this.scan().catch((error: unknown) => {
      this.logger.error("Initial overdue scan failed", error);
    });
    this.timer = setInterval(
      () => {
        void this.scan().catch((error: unknown) => {
          this.logger.error("Scheduled overdue scan failed", error);
        });
      },
      60 * 60 * 1000,
    );
    this.timer.unref();
  }

  public onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  public scan() {
    if (!this.running) {
      this.running = this.performScan().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  private async performScan() {
    const now = new Date();
    const overdueTasks = await this.prisma.taskInstance.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        currentDueAt: { lt: now },
        overdueAlerts: {
          none: { status: { in: ["OPEN", "HANDLED"] } },
        },
      },
      select: { id: true },
    });
    const alertsToResolve = await this.prisma.overdueAlert.findMany({
      where: {
        status: { in: ["OPEN", "HANDLED"] },
        OR: [
          { task: { status: { in: ["COMPLETED", "CANCELED"] } } },
          {
            task: {
              status: { in: [...ACTIVE_STATUSES] },
              currentDueAt: { gte: now },
            },
          },
        ],
      },
      select: { id: true, taskId: true },
    });

    let generated = 0;
    let resolved = 0;
    let failed = 0;
    for (const task of overdueTasks) {
      try {
        const created = await this.generateForTask(task.id, now);
        generated += created ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.error(`Overdue scan failed for task ${task.id}`, error);
      }
    }
    for (const alert of alertsToResolve) {
      try {
        const changed = await this.resolveAlert(alert.id, alert.taskId, now, "TASK_NORMALIZED");
        resolved += changed ? 1 : 0;
      } catch (error) {
        failed += 1;
        this.logger.error(`Overdue resolution failed for alert ${alert.id}`, error);
      }
    }
    return { generated, resolved, failed };
  }

  private async generateForTask(taskId: string, now: Date) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const task = await transaction.taskInstance.findUnique({
          where: { id: taskId },
          select: {
            id: true,
            status: true,
            currentDueAt: true,
            overdueAlerts: {
              where: { status: { in: ["OPEN", "HANDLED"] } },
              select: { id: true },
              take: 1,
            },
          },
        });
        if (
          !task ||
          !ACTIVE_STATUSES.includes(task.status as (typeof ACTIVE_STATUSES)[number]) ||
          task.currentDueAt >= now ||
          task.overdueAlerts.length > 0
        ) {
          return false;
        }
        const latest = await transaction.overdueAlert.aggregate({
          where: { taskId },
          _max: { overdueEpisodeNo: true },
        });
        const episode = (latest._max.overdueEpisodeNo ?? 0) + 1;
        const alert = await transaction.overdueAlert.create({
          data: {
            taskId,
            overdueEpisodeNo: episode,
            firstOverdueAt: task.currentDueAt,
            generatedAt: now,
          },
        });
        await transaction.taskTimelineEvent.create({
          data: {
            taskId,
            eventType: "OVERDUE_ALERT_GENERATED",
            summary: `系统生成第 ${episode} 次逾期提醒`,
            afterData: {
              alertId: alert.id,
              episode,
              firstOverdueAt: task.currentDueAt.toISOString(),
            },
          },
        });
        await transaction.auditLog.create({
          data: {
            operatorRole: "SYSTEM",
            objectType: "overdue_alert",
            objectId: alert.id,
            action: "OVERDUE_ALERT_GENERATED",
            afterData: {
              taskId,
              episode,
              firstOverdueAt: task.currentDueAt.toISOString(),
            },
            requestId: `overdue-scan-${now.getTime()}`,
          },
        });
        return true;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }

  private async resolveAlert(alertId: string, taskId: string, now: Date, reason: string) {
    return this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.overdueAlert.updateMany({
        where: { id: alertId, status: { in: ["OPEN", "HANDLED"] } },
        data: {
          status: "RESOLVED",
          resolvedAt: now,
          resolvedReason: reason,
        },
      });
      if (changed.count !== 1) {
        return false;
      }
      await transaction.taskTimelineEvent.create({
        data: {
          taskId,
          eventType: "OVERDUE_ALERT_RESOLVED",
          summary: "逾期提醒已由系统解除",
          reason,
          afterData: { alertId, status: "RESOLVED" },
        },
      });
      await transaction.auditLog.create({
        data: {
          operatorRole: "SYSTEM",
          objectType: "overdue_alert",
          objectId: alertId,
          action: "OVERDUE_ALERT_RESOLVED",
          afterData: { taskId, status: "RESOLVED", reason },
          requestId: `overdue-scan-${now.getTime()}`,
        },
      });
      return true;
    });
  }
}
