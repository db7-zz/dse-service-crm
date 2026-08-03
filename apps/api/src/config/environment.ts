import { z } from "zod";

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
    APP_ORIGIN: z.url().default("http://localhost:8080"),
    API_PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
    SESSION_COOKIE_NAME: z.string().min(1).default("dse_session"),
    SESSION_ABSOLUTE_TTL_SECONDS: z.coerce.number().int().positive().default(28_800),
    SESSION_IDLE_TTL_SECONDS: z.coerce.number().int().positive().default(7_200),
    LOGIN_FAILURE_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCK_SECONDS: z.coerce.number().int().positive().default(900),
    CSRF_COOKIE_NAME: z.string().min(1).default("dse_csrf"),
    TRUST_PROXY: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    FILE_STORAGE_ROOT: z.string().min(1).default("./tmp/uploads"),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().max(52_428_800).default(52_428_800),
  })
  .superRefine((value, context) => {
    if (
      (value.NODE_ENV === "staging" || value.NODE_ENV === "production") &&
      !value.APP_ORIGIN.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["APP_ORIGIN"],
        message: "staging and production require an HTTPS APP_ORIGIN",
      });
    }
  });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
  return environmentSchema.parse(input);
}
