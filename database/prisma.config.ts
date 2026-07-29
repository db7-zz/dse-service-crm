import { config as loadEnvironment } from "dotenv";
import { defineConfig, env } from "prisma/config";

loadEnvironment({
  path: new URL("../.env", import.meta.url),
  quiet: true,
});

const databaseUrl =
  process.env.DATABASE_URL ??
  (process.argv.includes("generate")
    ? "postgresql://prisma-generate:prisma-generate@127.0.0.1:5432/prisma-generate"
    : env("DATABASE_URL"));

export default defineConfig({
  schema: "schema.prisma",
  migrations: {
    path: "migrations",
    seed: "tsx seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
