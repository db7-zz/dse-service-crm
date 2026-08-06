import { apiClient } from "../auth/api";

export interface StudentHandoff {
  id: string;
  studentName: string;
  studentPhone: string | null;
  studentWechat: string | null;
  parentName: string;
  parentRelationship: string | null;
  parentPhone: string;
  parentWechat: string | null;
  school: string | null;
  grade: string | null;
  cohortYear: number | null;
  assignedButler: { id: string; displayName: string };
  createdBy: { id: string; displayName: string };
  acceptedBy: { id: string; displayName: string } | null;
  wechatGroupCreatedAt: string;
  status: "PENDING_ACCEPTANCE" | "ACCEPTED" | "CANCELED";
  student: null | {
    id: string;
    studentNo: string;
    serviceStatus: string;
    profileStatus: string;
    portalUser: null | { id: string; username: string; status: string };
  };
  acceptedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface HandoffFormValues {
  studentName: string;
  studentPhone?: string;
  studentWechat?: string;
  parentName: string;
  parentRelationship?: string;
  parentPhone: string;
  parentWechat?: string;
  school?: string;
  grade?: string;
  cohortYear?: number;
  assignedButlerId: string;
  wechatGroupCreatedAt: string;
}

function optional(value: string | undefined) {
  return value?.trim() || null;
}

export function listStudentHandoffs() {
  return apiClient.request<{ items: StudentHandoff[]; total: number }>(
    "/student-handoffs?page=1&pageSize=100",
  );
}

export function createStudentHandoff(values: HandoffFormValues) {
  return apiClient.request<StudentHandoff>("/student-handoffs", {
    method: "POST",
    body: JSON.stringify({
      ...values,
      studentName: values.studentName.trim(),
      studentPhone: optional(values.studentPhone),
      studentWechat: optional(values.studentWechat),
      parentName: values.parentName.trim(),
      parentRelationship: optional(values.parentRelationship),
      parentPhone: values.parentPhone.trim(),
      parentWechat: optional(values.parentWechat),
      school: optional(values.school),
      grade: optional(values.grade),
      cohortYear: values.cohortYear || null,
      wechatGroupCreatedAt: new Date(values.wechatGroupCreatedAt).toISOString(),
    }),
  });
}

export function acceptStudentHandoff(handoff: StudentHandoff) {
  return apiClient.request<{
    handoff: StudentHandoff;
    studentId: string;
    account: { username: string; temporaryPassword: string; expiresAt: string };
    onboardingMessage: string;
  }>(`/student-handoffs/${handoff.id}/accept`, {
    method: "POST",
    body: JSON.stringify({ version: handoff.version }),
  });
}
