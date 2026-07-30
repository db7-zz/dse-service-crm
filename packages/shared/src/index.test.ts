import { describe, expect, it } from "vitest";
import { AssignableRoleCodes, hasPermission, PermissionCode, RoleCode } from "./index.js";

describe("hasPermission", () => {
  it("returns true only for assigned permissions", () => {
    const user = { permissions: [PermissionCode.SYSTEM_USERS_READ] };
    expect(hasPermission(user, PermissionCode.SYSTEM_USERS_READ)).toBe(true);
    expect(hasPermission(user, PermissionCode.SYSTEM_USERS_WRITE)).toBe(false);
  });
});

describe("S1 role boundary", () => {
  it("keeps the legacy role code but prevents assigning it to new accounts", () => {
    expect(RoleCode.ERIC_MANAGER).toBe("ERIC_MANAGER");
    expect(AssignableRoleCodes).not.toContain(RoleCode.ERIC_MANAGER);
    expect(AssignableRoleCodes).toContain(RoleCode.ADMINISTRATOR);
  });
});
