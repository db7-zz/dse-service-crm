import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";

process.env.NODE_ENV ??= "test";
process.env.APP_ORIGIN ??= "http://localhost:8080";
process.env.DATABASE_URL ??= "postgresql://openapi:openapi@localhost:5432/openapi";

const [{ AppModule }, { configureApplication, createOpenApiDocument }] = await Promise.all([
  import("../app.module.js"),
  import("../bootstrap.js"),
]);
const app = await NestFactory.create(AppModule, { logger: false });
configureApplication(app);
await app.init();
const document = createOpenApiDocument(app);
const output = resolve(process.cwd(), "../../docs/api/openapi.json");
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
await app.close();
