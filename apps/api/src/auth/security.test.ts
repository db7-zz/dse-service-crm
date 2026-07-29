import { describe, expect, it } from "vitest";
import {
  calculateLoginFailure,
  generateOpaqueToken,
  hashToken,
  isSessionExpired,
} from "./security.js";

describe("authentication security", () => {
  it("hashes session tokens without storing the original", () => {
    const token = generateOpaqueToken();
    expect(token.length).toBeGreaterThan(32);
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toContain(token);
  });

  it("locks after the configured number of failures inside the window", () => {
    const now = new Date("2026-07-28T00:00:00.000Z");
    const result = calculateLoginFailure(now, 4, new Date("2026-07-27T23:55:00.000Z"), 900, 5, 900);
    expect(result.shouldLock).toBe(true);
    expect(result.lockedUntil?.toISOString()).toBe("2026-07-28T00:15:00.000Z");
  });

  it("resets failures after the window expires", () => {
    const now = new Date("2026-07-28T01:00:00.000Z");
    const result = calculateLoginFailure(now, 4, new Date("2026-07-28T00:00:00.000Z"), 900, 5, 900);
    expect(result.failedLoginCount).toBe(1);
    expect(result.shouldLock).toBe(false);
  });

  it("expires a session at either its absolute or idle boundary", () => {
    const now = new Date("2026-07-28T08:00:00.000Z");
    expect(
      isSessionExpired(
        now,
        new Date("2026-07-28T08:00:00.000Z"),
        new Date("2026-07-28T09:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isSessionExpired(
        now,
        new Date("2026-07-28T10:00:00.000Z"),
        new Date("2026-07-28T09:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
