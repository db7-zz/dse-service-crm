import { apiClient } from "../auth/api";
import type {
  ResponsiblePersonOptions,
  StudentDetail,
  StudentFormValues,
  StudentPageData,
  StudentRecord,
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
}) {
  const query = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.search?.trim()) query.set("search", input.search.trim());
  if (input.serviceStatus) query.set("serviceStatus", input.serviceStatus);
  if (input.defaultButlerId) query.set("defaultButlerId", input.defaultButlerId);
  if (input.plannerId) query.set("plannerId", input.plannerId);
  return apiClient.request<StudentPageData>(`/students?${query.toString()}`);
}

export function getResponsiblePersonOptions() {
  return apiClient.request<ResponsiblePersonOptions>("/students/responsible-person-options");
}

export function getStudent(studentId: string) {
  return apiClient.request<StudentDetail>(`/students/${studentId}`);
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
