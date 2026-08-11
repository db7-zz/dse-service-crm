import { apiClient } from "../auth/api";
import { arrayBufferToBase64, validateUploadFile } from "../files/file-upload";
import type {
  ApplicationAttentionPageView,
  ApplicationActivityType,
  ApplicationDashboardView,
  ApplicationRiskCode,
  ApplicationStageCode,
  ApplicationView,
  IssueView,
  MaterialItemView,
  MaterialSubmissionView,
  NotificationView,
  StudentFullRecordView,
} from "./operations-types";

export interface ApplicationDashboardFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  ownerId?: string;
  channel?: "HK_DIRECT" | "JUPAS";
  stage?: ApplicationStageCode;
  risk?: ApplicationRiskCode;
}

export function getMaterialTypes() {
  return apiClient.request<Array<{ id: string; code: string; name: string; isCore: boolean }>>(
    "/material-types",
  );
}

export function getMaterials(studentId: string) {
  return apiClient.request<{
    items: MaterialItemView[];
    summary: {
      total: number;
      approved: number;
      pendingReview: number;
      missing: number;
      missingCore: number;
    };
  }>(`/students/${studentId}/materials`);
}

export function runMaterialAutomationScan() {
  return apiClient.request<{
    dueSoonNotified: number;
    overdueNotified: number;
    reviewSlaNotified: number;
    failed: number;
  }>("/material-automation/scan", { method: "POST" });
}

export function createMaterial(studentId: string, input: object) {
  return apiClient.request<MaterialItemView>(`/students/${studentId}/materials`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createMaterialSubmission(materialId: string, reason: string) {
  return apiClient.request<MaterialSubmissionView>(`/materials/${materialId}/submissions`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function addMaterialSubmissionFile(submissionId: string, file: File) {
  const { mimeType } = validateUploadFile(file);
  return file.arrayBuffer().then((buffer) =>
    apiClient.request<MaterialSubmissionView["files"][number]>(
      `/material-submissions/${submissionId}/files`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          mimeType,
          contentBase64: arrayBufferToBase64(buffer),
        }),
      },
    ),
  );
}

export function removeMaterialSubmissionFile(submissionId: string, fileId: string, reason: string) {
  return apiClient.request<MaterialSubmissionView>(
    `/material-submissions/${submissionId}/files/${fileId}/remove`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function submitMaterialSubmission(submissionId: string) {
  return apiClient.request<MaterialSubmissionView>(`/material-submissions/${submissionId}/submit`, {
    method: "POST",
  });
}

export function startMaterialSubmissionReview(submissionId: string) {
  return apiClient.request<MaterialSubmissionView>(
    `/material-submissions/${submissionId}/review/start`,
    { method: "POST" },
  );
}

export function reviewMaterialSubmission(
  submissionId: string,
  input: {
    outcome: "APPROVED" | "NEEDS_CORRECTION";
    comment?: string;
    correctionDueAt?: string;
    fileDecisions: Array<{
      fileId: string;
      outcome: "APPROVED" | "CORRECTION_REQUIRED";
      comment?: string;
    }>;
  },
) {
  return apiClient.request<MaterialSubmissionView>(`/material-submissions/${submissionId}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function reviewMaterialApplicability(
  requestId: string,
  input: { outcome: "APPROVED" | "REJECTED"; comment?: string },
) {
  return apiClient.request(`/material-applicability-requests/${requestId}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function cancelSpecialMaterial(materialId: string, version: number, reason: string) {
  return apiClient.request(`/materials/${materialId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ version, reason }),
  });
}

export function uploadMaterial(materialId: string, file: File) {
  const { mimeType } = validateUploadFile(file);
  return file.arrayBuffer().then((buffer) =>
    apiClient.request<MaterialItemView>(`/materials/${materialId}/versions`, {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType,
        contentBase64: arrayBufferToBase64(buffer),
      }),
    }),
  );
}

export function reviewMaterial(
  materialId: string,
  input: {
    outcome:
      | "APPROVED"
      | "PARTIALLY_MISSING"
      | "RESUBMISSION_REQUIRED"
      | "AWAITING_CONFIRMATION"
      | "NOT_APPLICABLE";
    comment?: string;
    version: number;
  },
) {
  return apiClient.request<MaterialItemView>(`/materials/${materialId}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listApplications(input: {
  page?: number;
  pageSize?: number;
  search?: string;
  studentId?: string;
  status?: string;
  channel?: "HK_DIRECT" | "JUPAS";
}) {
  const query = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 100),
  });
  if (input.search) query.set("search", input.search);
  if (input.studentId) query.set("studentId", input.studentId);
  if (input.status) query.set("status", input.status);
  if (input.channel) query.set("channel", input.channel);
  return apiClient.request<{ items: ApplicationView[]; total: number }>(
    `/applications?${query.toString()}`,
  );
}

export function getApplication(applicationId: string) {
  return apiClient.request<ApplicationView>(`/applications/${applicationId}`);
}

export function getApplicationDashboard(input: ApplicationDashboardFilters) {
  return apiClient.request<ApplicationDashboardView>(
    `/applications/dashboard?${applicationDashboardQuery(input).toString()}`,
  );
}

export function getAttentionApplications(input: ApplicationDashboardFilters) {
  return apiClient.request<ApplicationAttentionPageView>(
    `/applications/attention?${applicationDashboardQuery(input).toString()}`,
  );
}

export function createApplication(input: object) {
  return apiClient.request<ApplicationView>("/applications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function changeApplicationStatus(applicationId: string, input: object) {
  return apiClient.request<ApplicationView>(`/applications/${applicationId}/change-status`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function addApplicationActivity(
  applicationId: string,
  input: {
    activityType: ApplicationActivityType;
    note: string;
    occurredAt?: string;
    studentVisible?: boolean;
    portalUrl?: string | null;
    applicationNo?: string | null;
    targetStatus?: "WAITLISTED" | "OFFER" | "REJECTED" | "ENROLLED";
    result?: string | null;
    offerCondition?: string | null;
    confirmationDeadline?: string | null;
    intakeDecision?: string | null;
    submittedAt?: string;
    correctionOfActivityId?: string;
    version: number;
  },
  file?: File,
) {
  return withOptionalFile(input, file).then((body) =>
    apiClient.request<ApplicationView>(`/applications/${applicationId}/activities`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export function addApplicationEvidence(
  applicationId: string,
  activityId: string,
  version: number,
  file: File,
) {
  return withOptionalFile({ version }, file).then((body) =>
    apiClient.request<ApplicationView>(
      `/applications/${applicationId}/activities/${activityId}/evidence`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  );
}

export function setApplicationMaterials(
  applicationId: string,
  materialVersionIds: string[],
  version: number,
) {
  return apiClient.request<ApplicationView>(`/applications/${applicationId}/materials`, {
    method: "POST",
    body: JSON.stringify({ materialVersionIds, version }),
  });
}

export function returnApplicationEvidence(
  applicationId: string,
  activityId: string,
  input: { reason: string; expectedBy?: string; version: number },
) {
  return apiClient.request<ApplicationView>(
    `/applications/${applicationId}/activities/${activityId}/return-evidence`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function transferApplicationOwner(
  applicationId: string,
  input: { ownerId: string; reason: string; version: number },
) {
  return apiClient.request<ApplicationView>(`/applications/${applicationId}/transfer-owner`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getApplicationOwnerOptions() {
  return apiClient
    .request<{
      items: Array<{
        id: string;
        displayName: string;
        status: string;
        roles: Array<{ code: string; name: string }>;
      }>;
    }>("/admin/users?page=1&pageSize=100&status=ACTIVE")
    .then((result) =>
      result.items
        .filter((user) => user.roles.some((role) => role.code === "BUTLER"))
        .map((user) => ({ id: user.id, displayName: user.displayName })),
    );
}

export function invalidateApplicationActivity(
  applicationId: string,
  activityId: string,
  reason: string,
) {
  return apiClient.request<ApplicationView>(
    `/applications/${applicationId}/activities/${activityId}/invalidate`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export function createApplicationRequirement(applicationId: string, input: object) {
  return apiClient.request<ApplicationView>(`/applications/${applicationId}/requirements`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listIssues(input: { studentId?: string; status?: string }) {
  const query = new URLSearchParams({ page: "1", pageSize: "100" });
  if (input.studentId) query.set("studentId", input.studentId);
  if (input.status) query.set("status", input.status);
  return apiClient.request<{ items: IssueView[]; total: number }>(`/issues?${query.toString()}`);
}

export function createIssue(input: object) {
  return apiClient.request<IssueView>("/issues", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function issueAction(issueId: string, action: string, input: object) {
  return apiClient.request<IssueView>(`/issues/${issueId}/${action}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listNotifications(unreadOnly = false) {
  return apiClient.request<{
    items: NotificationView[];
    total: number;
    unreadCount: number;
  }>(`/notifications?page=1&pageSize=100&unreadOnly=${unreadOnly}`);
}

export function markNotificationRead(notificationId: string) {
  return apiClient.request(`/notifications/${notificationId}/read`, { method: "POST" });
}

export function markAllNotificationsRead() {
  return apiClient.request("/notifications/read-all", { method: "POST" });
}

export function getStudentRecord(studentId: string) {
  return apiClient.request<StudentFullRecordView>(`/students/${studentId}/record`);
}

export function updateStudentRecord(studentId: string, input: object) {
  return apiClient.request<StudentFullRecordView>(`/students/${studentId}/record`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function updateStudentRisk(studentId: string, input: object) {
  return apiClient.request<StudentFullRecordView>(`/students/${studentId}/risk`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function updateStudentServiceStatus(studentId: string, input: object) {
  return apiClient.request<StudentFullRecordView>(`/students/${studentId}/service-status`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

function applicationDashboardQuery(input: ApplicationDashboardFilters) {
  const query = new URLSearchParams({
    page: String(input.page ?? 1),
    pageSize: String(input.pageSize ?? 20),
  });
  if (input.search?.trim()) query.set("search", input.search.trim());
  if (input.ownerId) query.set("ownerId", input.ownerId);
  if (input.channel) query.set("channel", input.channel);
  if (input.stage) query.set("stage", input.stage);
  if (input.risk) query.set("risk", input.risk);
  return query;
}

async function withOptionalFile<T extends object>(input: T, file?: File) {
  if (!file) return input;
  const { mimeType } = validateUploadFile(file);
  const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
  return { ...input, fileName: file.name, mimeType, contentBase64 };
}
