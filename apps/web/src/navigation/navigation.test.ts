import { describe, expect, it } from "vitest";
import { PermissionCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { defaultRouteFor, navigationFor } from "./navigation";

function user(permissions: AuthenticatedUser["permissions"]): AuthenticatedUser {
  return {
    id: "1",
    username: "test",
    displayName: "测试用户",
    roles: [RoleCode.BUTLER],
    permissions,
  };
}

describe("role navigation", () => {
  it("shows system pages only to users with system permissions", () => {
    const items = navigationFor(user([PermissionCode.WORKSPACE_ACCESS]));
    expect(items.map((item) => item.label)).toEqual(["工作区"]);
  });

  it("uses the supervision route for an administrator with the S1 permission", () => {
    const current = user([PermissionCode.WORKSPACE_ACCESS, PermissionCode.TASK_SUPERVISION_READ]);
    expect(defaultRouteFor(current)).toBe("/workspace/supervision");
    expect(navigationFor(current).map((item) => item.label)).toContain("监督管理看板");
  });

  it("routes an administrator with student access to student management first", () => {
    const current = user([
      PermissionCode.WORKSPACE_ACCESS,
      PermissionCode.STUDENTS_READ,
      PermissionCode.SYSTEM_USERS_READ,
    ]);
    expect(defaultRouteFor(current)).toBe("/workspace/students");
    expect(navigationFor(current).map((item) => item.label)).toContain("学生管理");
  });

  it("routes a butler directly to the personal task queue", () => {
    const current = user([
      PermissionCode.WORKSPACE_ACCESS,
      PermissionCode.TASKS_OWN_READ,
      PermissionCode.TASKS_OWN_WRITE,
    ]);
    expect(defaultRouteFor(current)).toBe("/workspace/my-tasks");
    expect(navigationFor(current).map((item) => item.label)).toContain("我的任务");
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
    expect(defaultRouteFor(current)).toBe("/forbidden");
    expect(navigationFor(current)).toEqual([]);
  });
});
