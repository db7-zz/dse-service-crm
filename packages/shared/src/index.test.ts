import { describe, expect, it } from "vitest";
import { hasPermission, PermissionCode } from "./index.js";

describe("hasPermission", () => {
  it("returns true only for assigned permissions", () => {
    const user = { permissions: [PermissionCode.SYSTEM_USERS_READ] };
    expect(hasPermission(user, PermissionCode.SYSTEM_USERS_READ)).toBe(true);
    expect(hasPermission(user, PermissionCode.SYSTEM_USERS_WRITE)).toBe(false);
  });
});
