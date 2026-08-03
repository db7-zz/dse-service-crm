import { apiClient } from "../auth/api";
import type {
  ResponsiblePersonOptions,
  StudentDetail,
  StudentFormValues,
  StudentPageData,
  StudentRecord,
  StudentServiceProgress,
} from "./student-types";

function nullable(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function listStudents(input: {
  page?: number;
  pageSize?: number;
  search?: string;
  serviceStatus?: string;
  defaultButlerId?: string;
  plannerId?: string;
  currentStageCode?: string;
  hasCurrentBlockers?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  mine?: boolean;
}) {
  const query = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.search?.trim()) query.set("search", input.search.trim());
  if (input.serviceStatus) query.set("serviceStatus", input.serviceStatus);
  if (input.defaultButlerId) query.set("defaultButlerId", input.defaultButlerId);
  if (input.plannerId) query.set("plannerId", input.plannerId);
  if (input.currentStageCode) query.set("currentStageCode", input.currentStageCode);
  if (input.hasCurrentBlockers !== undefined) {
    query.set("hasCurrentBlockers", String(input.hasCurrentBlockers));
  }
  if (input.sortBy) query.set("sortBy", input.sortBy);
  if (input.sortOrder) query.set("sortOrder", input.sortOrder);
  return apiClient.request<StudentPageData>(
    `${input.mine ? "/my/students" : "/students"}?${query.toString()}`,
  );
}

export function getResponsiblePersonOptions() {
  return apiClient.request<ResponsiblePersonOptions>("/students/responsible-person-options");
}

export function getStudent(studentId: string, mine = false) {
  return apiClient.request<StudentDetail>(`${mine ? "/my/students" : "/students"}/${studentId}`);
}

export function getStudentServiceProgress(studentId: string, mine = false) {
  return apiClient.request<StudentServiceProgress>(
    `${mine ? "/my/students" : "/students"}/${studentId}/service-progress`,
  );
}

export function createManualTask(input: {
  studentId: string;
  stageInstanceId: string;
  title: string;
  description?: string;
  completionCriteria?: string;
  currentDueAt: string;
  ownerId?: string;
  isBlocking: boolean;
  stageVersion: number;
}) {
  return apiClient.request(`/students/${input.studentId}/manual-tasks`, {
    method: "POST",
    headers: { "Idempotency-Key": `manual-task-${input.studentId}-${crypto.randomUUID()}` },
    body: JSON.stringify({
      stageInstanceId: input.stageInstanceId,
      title: input.title.trim(),
      description: nullable(input.description),
      completionCriteria: nullable(input.completionCriteria),
      currentDueAt: input.currentDueAt,
      ownerId: input.ownerId ?? null,
      isBlocking: input.isBlocking,
      stageVersion: input.stageVersion,
    }),
  });
}

export function recalculateServiceProgress(studentId: string) {
  return apiClient.request(`/students/${studentId}/service-progress/recalculate`, {
    method: "POST",
    headers: { "Idempotency-Key": `progress-recalculation-${studentId}-${crypto.randomUUID()}` },
  });
}

export function createStudent(values: StudentFormValues) {
  return apiClient.request<StudentRecord>("/students", {
    method: "POST",
    body: JSON.stringify({
      name: values.name.trim(),
      phone: nullable(values.phone),
      email: nullable(values.email),
      defaultButlerId: values.defaultButlerId ?? null,
      plannerId: values.plannerId ?? null,
    }),
  });
}

export function updateStudent(
  studentId: string,
  values: Pick<StudentFormValues, "name" | "phone" | "email">,
  version: number,
) {
  return apiClient.request<StudentRecord>(`/students/${studentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: values.name.trim(),
      phone: nullable(values.phone),
      email: nullable(values.email),
      version,
      reason: "管理员在学生编辑页更新基础资料",
    }),
  });
}

export function assignResponsiblePerson(input: {
  studentId: string;
  type: "default-butler" | "planner";
  userId: string | null;
  reason: string;
  version: number;
}) {
  return apiClient.request<StudentRecord>(`/students/${input.studentId}/${input.type}`, {
    method: "PUT",
    body: JSON.stringify({
      userId: input.userId,
      reason: input.reason.trim(),
      version: input.version,
    }),
  });
}

export function activateStudentService(studentId: string, version: number) {
  return apiClient.request(`/students/${studentId}/service-activation`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export function bulkAssignStudentTasks(input: {
  studentId: string;
  butlerId: string;
  reason: string;
  tasks: Array<{ taskId: string; version: number }>;
}) {
  return apiClient.request(`/students/${input.studentId}/assign-unassigned-tasks`, {
    method: "POST",
    headers: {
      "Idempotency-Key": `bulk-assign-${input.studentId}-${crypto.randomUUID()}`,
    },
    body: JSON.stringify({
      butlerId: input.butlerId,
      reason: input.reason.trim(),
      tasks: input.tasks,
    }),
  });
}
