import {
  PermissionCode,
  type AuthenticatedUser,
  type PermissionCode as PermissionCodeType,
} from "@dse/shared";

export interface NavigationItem {
  key: string;
  label: string;
  href: string;
  permission?: PermissionCodeType;
}

const NAVIGATION: NavigationItem[] = [
  {
    key: "workspace",
    label: "工作区",
    href: "/workspace",
    permission: PermissionCode.WORKSPACE_ACCESS,
  },
  {
    key: "students",
    label: "学生管理",
    href: "/workspace/students",
    permission: PermissionCode.STUDENTS_READ,
  },
  {
    key: "sop",
    label: "SOP 版本",
    href: "/workspace/sop",
    permission: PermissionCode.SOP_READ,
  },
  {
    key: "my-tasks",
    label: "我的任务",
    href: "/workspace/my-tasks",
    permission: PermissionCode.TASKS_OWN_READ,
  },
  {
    key: "supervision",
    label: "监督管理看板",
    href: "/workspace/supervision",
    permission: PermissionCode.TASK_SUPERVISION_READ,
  },
  {
    key: "users",
    label: "账号管理",
    href: "/workspace/system/users",
    permission: PermissionCode.SYSTEM_USERS_READ,
  },
  {
    key: "audit",
    label: "审计日志",
    href: "/workspace/system/audit-logs",
    permission: PermissionCode.SYSTEM_AUDIT_READ,
  },
];

export function navigationFor(user: AuthenticatedUser): NavigationItem[] {
  return NAVIGATION.filter(
    (item) => !item.permission || user.permissions.includes(item.permission),
  );
}

export function defaultRouteFor(user: AuthenticatedUser): string {
  if (user.permissions.includes(PermissionCode.TASKS_OWN_READ)) {
    return "/workspace/my-tasks";
  }
  if (user.permissions.includes(PermissionCode.STUDENTS_READ)) {
    return "/workspace/students";
  }
  if (user.permissions.includes(PermissionCode.SYSTEM_USERS_READ)) {
    return "/workspace/system/users";
  }
  if (user.permissions.includes(PermissionCode.TASK_SUPERVISION_READ)) {
    return "/workspace/supervision";
  }
  if (user.permissions.includes(PermissionCode.WORKSPACE_ACCESS)) {
    return "/workspace";
  }
  return "/forbidden";
}
