export * from "./storage.js";

export const RoleCode = {
  ADMINISTRATOR: "ADMINISTRATOR",
  ERIC_MANAGER: "ERIC_MANAGER",
  BUTLER: "BUTLER",
  PLANNER: "PLANNER",
  SPECIALIST: "SPECIALIST",
  STUDENT: "STUDENT",
} as const;

export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

export const AssignableRoleCodes = [
  RoleCode.ADMINISTRATOR,
  RoleCode.BUTLER,
  RoleCode.PLANNER,
  RoleCode.SPECIALIST,
  RoleCode.STUDENT,
] as const;

export type AssignableRoleCode = (typeof AssignableRoleCodes)[number];

export const PermissionCode = {
  WORKSPACE_ACCESS: "workspace.access",
  SUPERVISION_ACCESS: "supervision.access",
  SYSTEM_USERS_READ: "system.users.read",
  SYSTEM_USERS_WRITE: "system.users.write",
  SYSTEM_AUDIT_READ: "system.audit.read",
  PORTAL_ACCESS: "portal.access",
  STUDENTS_READ: "students.read",
  STUDENTS_WRITE: "students.write",
  SOP_READ: "sop.read",
  SOP_WRITE: "sop.write",
  SERVICE_ACTIVATION_WRITE: "service.activation.write",
  TASKS_OWN_READ: "tasks.own.read",
  TASKS_OWN_WRITE: "tasks.own.write",
  TASK_SUPERVISION_READ: "tasks.supervision.read",
  TASK_SUPERVISION_WRITE: "tasks.supervision.write",
  OVERDUE_ALERTS_READ: "overdue-alerts.read",
  OVERDUE_ALERTS_WRITE: "overdue-alerts.write",
} as const;

export type PermissionCode = (typeof PermissionCode)[keyof typeof PermissionCode];

export const ErrorCode = {
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_ACCOUNT_DISABLED: "AUTH_ACCOUNT_DISABLED",
  AUTH_ACCOUNT_LOCKED: "AUTH_ACCOUNT_LOCKED",
  AUTH_SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  AUTH_CSRF_INVALID: "AUTH_CSRF_INVALID",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RESOURCE_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CONFLICT: "CONFLICT",
  STUDENT_NUMBER_CONFLICT: "STUDENT_NUMBER_CONFLICT",
  STUDENT_VERSION_CONFLICT: "STUDENT_VERSION_CONFLICT",
  RESPONSIBLE_PERSON_INVALID: "RESPONSIBLE_PERSON_INVALID",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface ApiError {
  code: ErrorCode | string;
  message: string;
  details: Record<string, unknown>;
}

export type ApiEnvelope<T> =
  | {
      success: true;
      data: T;
      error: null;
      requestId: string;
    }
  | {
      success: false;
      data: null;
      error: ApiError;
      requestId: string;
    };

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface AuditEvent {
  id: string;
  operatorId: string | null;
  operatorRole: RoleCode | null;
  objectType: string;
  objectId: string | null;
  action: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  reason: string | null;
  requestId: string;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: string;
}

export function hasPermission(
  user: Pick<AuthenticatedUser, "permissions">,
  permission: PermissionCode,
): boolean {
  return user.permissions.includes(permission);
}
