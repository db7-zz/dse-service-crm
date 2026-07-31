import { apiClient } from "../auth/api";
import type {
  OverdueAlertPage,
  SupervisionSummary,
  TaskDetail,
  TaskPage,
  TaskStatus,
} from "./task-types";

export interface TaskFilters {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  ownerId?: string;
  studentId?: string;
  stageCode?: string;
  overdue?: boolean;
  unassigned?: boolean;
  openAlert?: boolean;
  dueFrom?: string;
  dueTo?: string;
}

function taskQuery(filters: TaskFilters) {
  const query = new URLSearchParams({
    page: String(filters.page ?? 1),
    pageSize: String(filters.pageSize ?? 20),
  });
  for (const key of ["status", "ownerId", "studentId", "stageCode", "dueFrom", "dueTo"] as const) {
    if (filters[key]) query.set(key, String(filters[key]));
  }
  if (filters.overdue !== undefined) query.set("overdue", String(filters.overdue));
  if (filters.unassigned !== undefined) query.set("unassigned", String(filters.unassigned));
  if (filters.openAlert !== undefined) query.set("openAlert", String(filters.openAlert));
  return query.toString();
}

export function listMyTasks(filters: TaskFilters) {
  return apiClient.request<TaskPage>(`/my/tasks?${taskQuery(filters)}`);
}

export function listSupervisionTasks(filters: TaskFilters) {
  return apiClient.request<TaskPage>(`/admin/task-supervision/tasks?${taskQuery(filters)}`);
}

export function getSupervisionSummary(filters: TaskFilters) {
  return apiClient.request<SupervisionSummary>(
    `/admin/task-supervision/summary?${taskQuery({ ...filters, page: 1, pageSize: 100 })}`,
  );
}

export function getTask(taskId: string) {
  return apiClient.request<TaskDetail>(`/tasks/${taskId}`);
}

function idempotencyKey(operation: string, taskId: string) {
  return `${operation}-${taskId}-${crypto.randomUUID()}`;
}

function taskWrite(path: string, operation: string, taskId: string, body: Record<string, unknown>) {
  return apiClient.request<TaskDetail>(path, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey(operation, taskId) },
    body: JSON.stringify(body),
  });
}

export function startTask(taskId: string, version: number) {
  return taskWrite(`/tasks/${taskId}/start`, "start", taskId, { version });
}

export function updateTaskProgress(input: {
  taskId: string;
  version: number;
  progressNote: string;
  progressPercent?: number;
}) {
  return taskWrite(`/tasks/${input.taskId}/progress`, "progress", input.taskId, {
    version: input.version,
    progressNote: input.progressNote.trim(),
    ...(input.progressPercent !== undefined ? { progressPercent: input.progressPercent } : {}),
  });
}

export function reportTaskExtension(input: {
  taskId: string;
  version: number;
  reason: string;
  expectedFinishAt: string;
}) {
  return taskWrite(`/tasks/${input.taskId}/extensions`, "extension", input.taskId, {
    version: input.version,
    reason: input.reason.trim(),
    expectedFinishAt: input.expectedFinishAt,
  });
}

export function completeTask(input: { taskId: string; version: number; completionNote: string }) {
  return taskWrite(`/tasks/${input.taskId}/complete`, "complete", input.taskId, {
    version: input.version,
    completionNote: input.completionNote.trim(),
  });
}

export function rescheduleTask(input: {
  taskId: string;
  version: number;
  newDueAt: string;
  reason: string;
}) {
  return taskWrite(`/admin/tasks/${input.taskId}/reschedule`, "reschedule", input.taskId, {
    version: input.version,
    newDueAt: input.newDueAt,
    reason: input.reason.trim(),
  });
}

export function reassignTask(input: {
  taskId: string;
  version: number;
  newOwnerId: string;
  reason: string;
}) {
  return taskWrite(`/admin/tasks/${input.taskId}/reassign`, "reassign", input.taskId, {
    version: input.version,
    newOwnerId: input.newOwnerId,
    reason: input.reason.trim(),
  });
}

export function cancelTask(input: { taskId: string; version: number; reason: string }) {
  return taskWrite(`/admin/tasks/${input.taskId}/cancel`, "cancel", input.taskId, {
    version: input.version,
    reason: input.reason.trim(),
  });
}

export function listOverdueAlerts(status?: string) {
  const query = new URLSearchParams({ page: "1", pageSize: "100" });
  if (status) query.set("status", status);
  return apiClient.request<OverdueAlertPage>(`/admin/overdue-alerts?${query.toString()}`);
}

export function handleOverdueAlert(alertId: string, taskId: string, note?: string) {
  return apiClient.request(`/admin/overdue-alerts/${alertId}/handle`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey("handle-alert", taskId) },
    body: JSON.stringify({ note: note?.trim() || undefined }),
  });
}
