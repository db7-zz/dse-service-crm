import type { NotificationEventType, Prisma, PrismaClient } from "@dse/database";
import type { AuthenticatedUser } from "@dse/shared";
import { Inject, Injectable } from "@nestjs/common";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type { ListNotificationsQueryDto } from "./notifications.dto.js";

export interface CreateNotificationInput {
  recipientId: string;
  eventType: NotificationEventType;
  title: string;
  content: string;
  objectType?: string;
  objectId?: string;
  actionUrl?: string;
  eventKey?: string;
}

@Injectable()
export class NotificationsService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(query: ListNotificationsQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const where = {
      recipientId: actor.id,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        readAt: item.readAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
      unreadCount,
    };
  }

  public async markRead(notificationId: string, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientId: actor.id },
      data: { readAt: now },
    });
    return { updated: result.count === 1, readAt: result.count === 1 ? now.toISOString() : null };
  }

  public async markAllRead(request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const now = new Date();
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: actor.id, readAt: null },
      data: { readAt: now },
    });
    return { updatedCount: result.count, readAt: now.toISOString() };
  }

  public async create(input: CreateNotificationInput) {
    return this.createInTransaction(this.prisma, input);
  }

  public async createInTransaction(
    transaction: Prisma.TransactionClient | PrismaClient,
    input: CreateNotificationInput,
  ) {
    const data = {
      recipientId: input.recipientId,
      eventType: input.eventType,
      title: input.title,
      content: input.content,
      objectType: input.objectType,
      objectId: input.objectId,
      actionUrl: input.actionUrl,
      eventKey: input.eventKey,
    };
    if (!input.eventKey) {
      return transaction.notification.create({ data });
    }
    return transaction.notification.upsert({
      where: { eventKey: input.eventKey },
      update: {},
      create: data,
    });
  }
}
