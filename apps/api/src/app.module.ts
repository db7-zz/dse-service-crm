import { fileURLToPath } from "node:url";
import { MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import type { Environment } from "./config/environment.js";
import { validateEnvironment } from "./config/environment.js";
import { ApiEnvelopeInterceptor } from "./common/api-envelope.interceptor.js";
import { ApiExceptionFilter } from "./common/api-exception.filter.js";
import { RequestIdMiddleware } from "./common/request-id.middleware.js";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { HealthModule } from "./health/health.module.js";
import { SopModule } from "./sop/sop.module.js";
import { StudentsModule } from "./students/students.module.js";
import { TasksModule } from "./tasks/tasks.module.js";
import { AccessModule } from "./access/access.module.js";
import { ApplicationsModule } from "./applications/applications.module.js";
import { IssuesModule } from "./issues/issues.module.js";
import { MaterialsModule } from "./materials/materials.module.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { PortalModule } from "./portal/portal.module.js";
import { StudentRecordsModule } from "./student-records/student-records.module.js";
import { RectificationsModule } from "./rectifications/rectifications.module.js";

const rootEnvironmentFile = fileURLToPath(new URL("../../../.env", import.meta.url));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: rootEnvironmentFile,
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        pinoHttp: {
          level: config.get("LOG_LEVEL", { infer: true }),
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.body.password",
              "res.headers.set-cookie",
            ],
            censor: "[REDACTED]",
          },
          customProps: (request) => ({
            requestId: (request as typeof request & { requestId?: string }).requestId,
          }),
        },
      }),
    }),
    DatabaseModule,
    AccessModule,
    AuthModule,
    NotificationsModule,
    AdminModule,
    AuditModule,
    SopModule,
    StudentsModule,
    TasksModule,
    StudentRecordsModule,
    MaterialsModule,
    ApplicationsModule,
    IssuesModule,
    PortalModule,
    RectificationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*splat");
  }
}
