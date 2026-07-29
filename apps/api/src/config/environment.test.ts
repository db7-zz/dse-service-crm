import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment.js";

describe("validateEnvironment", () => {
  it("applies safe development defaults", () => {
    const environment = validateEnvironment({
      DATABASE_URL: "postgresql://localhost/test",
    });
    expect(environment.SESSION_ABSOLUTE_TTL_SECONDS).toBe(28_800);
    expect(environment.LOGIN_MAX_FAILURES).toBe(5);
  });

  it("rejects insecure production origins", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://localhost/test",
        APP_ORIGIN: "http://example.com",
      }),
    ).toThrow();
  });
});
