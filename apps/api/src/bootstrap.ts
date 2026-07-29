import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import type { Environment } from "./config/environment.js";

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  const origin = config.get("APP_ORIGIN", { infer: true });
  const environment = config.get("NODE_ENV", { infer: true });

  const httpAdapter = app.getHttpAdapter().getInstance() as {
    set?: (name: string, value: boolean | number | string) => void;
  };
  if (config.get("TRUST_PROXY", { infer: true })) {
    httpAdapter.set?.("trust proxy", 1);
  }

  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: environment === "production" ? undefined : false,
    }),
  );
  app.enableCors({
    origin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();
}

function addEnvelopeSchemas(document: OpenAPIObject): OpenAPIObject {
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.ApiError = {
    type: "object",
    required: ["code", "message", "details"],
    properties: {
      code: { type: "string" },
      message: { type: "string" },
      details: { type: "object", additionalProperties: true },
    },
  };
  document.components.schemas.ApiEnvelope = {
    type: "object",
    required: ["success", "data", "error", "requestId"],
    properties: {
      success: { type: "boolean" },
      data: { nullable: true },
      error: {
        allOf: [{ $ref: "#/components/schemas/ApiError" }],
        nullable: true,
      },
      requestId: { type: "string", format: "uuid" },
    },
  };

  const methods = ["get", "post", "put", "patch", "delete", "options", "head"] as const;
  for (const pathItem of Object.values(document.paths)) {
    for (const method of methods) {
      const operation = pathItem?.[method];
      if (!operation) {
        continue;
      }
      for (const response of Object.values(operation.responses ?? {})) {
        if (!response || "$ref" in response) {
          continue;
        }
        response.content = {
          ...(response.content ?? {}),
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiEnvelope" },
          },
        };
      }
    }
  }
  return document;
}

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("DSE升学服务CRM API")
    .setDescription("阶段0认证、权限、账号、审计和健康检查接口")
    .setVersion("0.1.0")
    .addCookieAuth("dse_session")
    .build();
  return addEnvelopeSchemas(SwaggerModule.createDocument(app, config));
}

export function configureSwagger(app: INestApplication): void {
  const config = app.get(ConfigService<Environment, true>);
  if (config.get("NODE_ENV", { infer: true }) !== "production") {
    SwaggerModule.setup("api/docs", app, createOpenApiDocument(app));
  }
}
