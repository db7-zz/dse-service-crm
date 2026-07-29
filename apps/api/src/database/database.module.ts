import { Global, Inject, Injectable, Module, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPrismaClient, type PrismaClient } from "@dse/database";
import type { Environment } from "../config/environment.js";

export const PRISMA = Symbol("PRISMA");

@Injectable()
class PrismaLifecycle implements OnModuleDestroy {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) =>
        createPrismaClient(config.get("DATABASE_URL", { infer: true })),
    },
    PrismaLifecycle,
  ],
  exports: [PRISMA],
})
export class DatabaseModule {}
