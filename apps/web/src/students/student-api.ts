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
  school?: string;
  grade?: string;
  cohortYear?: number;
  riskLevel?: string;
  hasMissingMaterials?: boolean;
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
  if (input.school) query.set("school", input.school);
  if (input.grade) query.set("grade", input.grade);
  if (input.cohortYear) query.set("cohortYear", String(input.cohortYear));
  if (input.riskLevel) query.set("riskLevel", input.riskLevel);
  if (input.hasMissingMaterials !== undefined)
    query.set("hasMissingMaterials", String(input.hasMissingMaterials));
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

export function createStudent(values: StudentFormValues, mine = false) {
  return apiClient.request<StudentRecord>(mine ? "/my/students" : "/students", {
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

export function checkStudentNameDuplicates(name: string, mine = false) {
  const query = new URLSearchParams({ name: name.trim() });
  return apiClient.request<{ name: string; hasDuplicates: boolean; count: number }>(
    `${mine ? "/my/students" : "/students"}/name-duplicates?${query.toString()}`,
  );
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

export function activateStudentService(studentId: string, version: number, mine = false) {
  return apiClient.request<{
    studentId: string;
    serviceStatus: "ENABLED";
    version: number;
    account: { username: string; temporaryPassword: string; expiresAt: string };
  }>(`${mine ? "/my/students" : "/students"}/${studentId}/service-activation`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export function repairStudentAccount(studentId: string, version: number) {
  return apiClient.request<{
    studentId: string;
    version: number;
    account: { username: string; temporaryPassword: string; expiresAt: string };
  }>(`/students/${studentId}/account-repair`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export interface StudentProfileSubmissionView {
  profileStatus: "INFORMATION_PENDING" | "PENDING_REVIEW" | "CONFIRMED" | "PLANNER_ASSIGNED";
  official: Record<string, string | number | string[] | null>;
  submission: null | {
    id: string;
    data: Record<string, string | number | string[]>;
    version: number;
    submittedAt: string;
    confirmedAt: string | null;
  };
}

export function getStudentProfileSubmission(studentId: string) {
  return apiClient.request<StudentProfileSubmissionView>(
    `/my/students/${studentId}/profile-submission`,
  );
}

export function confirmStudentProfileSubmission(studentId: string, version: number) {
  return apiClient.request(`/my/students/${studentId}/profile-submission/confirm`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}

export function resetMyStudentAccount(studentId: string) {
  return apiClient.request<{
    studentId: string;
    account: { username: string; temporaryPassword: string; expiresAt: string };
  }>(`/my/students/${studentId}/account-reset`, { method: "POST" });
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
