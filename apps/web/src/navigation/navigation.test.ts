import { describe, expect, it } from "vitest";
import { PermissionCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { defaultRouteFor, navigationFor } from "./navigation";

function user(
  permissions: AuthenticatedUser["permissions"],
  roles: AuthenticatedUser["roles"] = [RoleCode.BUTLER],
): AuthenticatedUser {
  return {
    id: "1",
    username: "test",
    displayName: "测试用户",
    roles,
    permissions,
  };
}

describe("role navigation", () => {
  it("shows system pages only to users with system permissions", () => {
    const items = navigationFor(user([PermissionCode.WORKSPACE_ACCESS]));
    expect(items.map((item) => item.label)).toEqual(["工作区"]);
  });

  it("uses the real workspace overview for an administrator", () => {
    const current = user(
      [
        PermissionCode.WORKSPACE_ACCESS,
        PermissionCode.STUDENTS_READ,
        PermissionCode.SYSTEM_USERS_READ,
        PermissionCode.TASK_SUPERVISION_READ,
      ],
      [RoleCode.ADMINISTRATOR],
    );
    expect(defaultRouteFor(current)).toBe("/workspace");
    expect(navigationFor(current).map((item) => item.label)).toContain("监督管理看板");
  });

  it("keeps the administrator workspace as the default without supervision access", () => {
    const current = user(
      [
        PermissionCode.WORKSPACE_ACCESS,
        PermissionCode.STUDENTS_READ,
        PermissionCode.SYSTEM_USERS_READ,
      ],
      [RoleCode.ADMINISTRATOR],
    );
    expect(defaultRouteFor(current)).toBe("/workspace");
    expect(navigationFor(current).map((item) => item.label)).toContain("学生管理");
  });

  it("routes a butler directly to the personal task queue", () => {
    const current = user([
      PermissionCode.WORKSPACE_ACCESS,
      PermissionCode.STUDENTS_OWN_READ,
      PermissionCode.TASKS_OWN_READ,
      PermissionCode.TASKS_OWN_WRITE,
    ]);
    expect(defaultRouteFor(current)).toBe("/workspace/my-tasks");
    expect(navigationFor(current).map((item) => item.label)).toContain("我的任务");
    expect(navigationFor(current).map((item) => item.label)).toContain("学生管理");
  });

  it("does not expose S1 supervision through the legacy permission", () => {
    const current = user([PermissionCode.WORKSPACE_ACCESS, PermissionCode.SUPERVISION_ACCESS]);
    expect(navigationFor(current).map((item) => item.label)).not.toContain("监督管理看板");
  });

  it("does not route a portal-only student into the internal workspace", () => {
    const current: AuthenticatedUser = {
      ...user([]),
      roles: [RoleCode.STUDENT],
      permissions: [PermissionCode.PORTAL_ACCESS],
    };
    expect(defaultRouteFor(current)).toBe("/portal");
    expect(navigationFor(current)).toEqual([]);
  });
});
