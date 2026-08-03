import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@dse/database";
import { PRISMA } from "../database/database.module.js";

@Injectable()
export class AuditService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(input: {
    page: number;
    pageSize: number;
    action?: string;
    objectType?: string;
  }) {
    const where = {
      ...(input.action ? { action: input.action } : {}),
      ...(input.objectType ? { objectType: input.objectType } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          operator: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }
}
