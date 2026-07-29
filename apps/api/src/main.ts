import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { ConfigService } from "@nestjs/config";
import type { Environment } from "./config/environment.js";
import { AppModule } from "./app.module.js";
import { configureApplication, configureSwagger } from "./bootstrap.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApplication(app);
  configureSwagger(app);
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.get("API_PORT", { infer: true }), "0.0.0.0");
}

await bootstrap();
