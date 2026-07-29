import { Controller, Get, Inject } from "@nestjs/common";
import type { PrismaClient } from "@dse/database";
import { PRISMA } from "../database/database.module.js";

@Controller("health")
export class HealthController {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get("live")
  public live() {
    return { status: "ok" };
  }

  @Get("ready")
  public async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: "ready" };
  }
}
