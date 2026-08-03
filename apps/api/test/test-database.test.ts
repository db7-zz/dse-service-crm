import { describe, expect, it } from "vitest";
import { assertSafeTestDatabaseUrl } from "./test-database.js";

describe("test database isolation", () => {
  it("accepts dedicated test and CI databases", () => {
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@localhost:5432/dse_crm_test?schema=public"),
    ).not.toThrow();
    expect(() =>
      assertSafeTestDatabaseUrl("postgresql://user:pass@localhost:5432/dse-crm-ci"),
    ).not.toThrow();
  });

  it("rejects development databases even when a test-looking schema is supplied", () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        "postgresql://user:pass@localhost:5432/dse_crm_dev?schema=codex_ci_fix",
      ),
    ).toThrow(/独立数据库/);
  });
});
