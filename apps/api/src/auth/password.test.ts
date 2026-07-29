import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password security", () => {
  it("creates an Argon2id hash and verifies the matching password", async () => {
    const hash = await hashPassword("A-strong-development-password");
    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, "A-strong-development-password")).resolves.toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await hashPassword("A-strong-development-password");
    await expect(verifyPassword(hash, "A-different-development-password")).resolves.toBe(false);
  });
});
