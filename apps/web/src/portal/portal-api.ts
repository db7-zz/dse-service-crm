import { apiClient } from "../auth/api";
import { arrayBufferToBase64, validateUploadFile } from "../files/file-upload";

export interface PortalSummary {
  student: {
    id: string;
    studentNo: string;
    name: string;
    englishName: string | null;
    school: string | null;
    grade: string | null;
    cohortYear: number | null;
  };
  serviceStatus: string;
  progress: null | {
    completedStageCount: number;
    totalStageCount: number;
    currentStage: { code: string; name: string; sequenceNo: number } | null;
    nextMilestone: string | null;
  };
  todo: {
    tasks: Array<{ id: string; title: string; dueAt: string; status: string }>;
    missingMaterials: Array<{
      id: string;
      title: string;
      status: string;
      dueAt: string | null;
      expectedSubmitAt: string | null;
    }>;
    confirmations: Array<{ id: string; prompt: string; dueAt: string | null }>;
  };
  applications: Array<{
    id: string;
    channel: string;
    institutionName: string;
    programName: string | null;
    status: string;
    updatedAt: string;
  }>;
  unreadNotificationCount: number;
}

export interface PortalMaterial {
  id: string;
  title: string;
  materialType: {
    code: string;
    name: string;
    isCore: boolean;
    inputMode: "FILE" | "FORM" | "SECURE_REFERENCE";
    collectionPhase: "CURRENT" | "LATER";
    sequenceNo: number;
  };
  requirement: string | null;
  dueAt: string | null;
  status: string;
  missingReason: string | null;
  expectedSubmitAt: string | null;
  currentVersion: null | {
    id: string;
    versionNo: number;
    fileName: string;
    reviewStatus: string;
    reviewComment: string | null;
    uploadedAt: string;
  };
  versions: Array<{
    id: string;
    versionNo: number;
    fileName: string;
    reviewStatus: string;
    reviewComment: string | null;
    uploadedAt: string;
    downloadUrl: string;
  }>;
}

export function getPortalSummary() {
  return apiClient.request<PortalSummary>("/portal/me/summary");
}

export function getPortalMaterials() {
  return apiClient.request<{ items: PortalMaterial[] }>("/portal/me/materials");
}

export interface PortalProfileData {
  studentName: string;
  cohortYear: number;
  grade: string;
  school: string;
  studentPhone: string;
  studentWechat: string;
  parentName: string;
  parentRelationship: string;
  parentPhone: string;
  parentWechat: string;
  identityCategory: string;
  examCandidateType: string;
  dseSubjects: string[];
  scoreSummary: string;
  targetDirection: string;
}

export function getPortalProfile() {
  return apiClient.request<{
    profileStatus: "INFORMATION_PENDING" | "PENDING_REVIEW" | "CONFIRMED" | "PLANNER_ASSIGNED";
    official: Partial<PortalProfileData>;
    submission: null | {
      data: PortalProfileData;
      version: number;
      submittedAt: string;
      confirmedAt: string | null;
    };
  }>("/portal/me/profile");
}

export function submitPortalProfile(values: PortalProfileData) {
  return apiClient.request<{ profileStatus: string; version: number; submittedAt: string }>(
    "/portal/me/profile",
    { method: "POST", body: JSON.stringify(values) },
  );
}

export function uploadPortalMaterial(materialId: string, file: File) {
  const { mimeType } = validateUploadFile(file);
  return file.arrayBuffer().then((buffer) =>
    apiClient.request(`/portal/me/materials/${materialId}/upload`, {
      method: "POST",
      body: JSON.stringify({
        fileName: file.name,
        mimeType,
        contentBase64: arrayBufferToBase64(buffer),
      }),
    }),
  );
}

export function getPortalProgress() {
  return apiClient.request<{
    serviceStatus: string;
    progress: null | {
      completedStageCount: number;
      totalStageCount: number;
      currentStageCode: string | null;
      nextMilestone: string | null;
    };
    stages: Array<{
      id: string;
      code: string;
      name: string;
      sequenceNo: number;
      status: string;
      startedAt: string | null;
      completedAt: string | null;
      tasks: Array<{ id: string; title: string; status: string; dueAt: string }>;
    }>;
  }>("/portal/me/progress");
}

export function getPortalApplications() {
  return apiClient.request<{
    items: Array<{
      id: string;
      channel: string;
      institutionName: string;
      programName: string | null;
      preferenceNo: number | null;
      status: string;
      submittedAt: string | null;
      applicationNo: string | null;
      result: string | null;
      offerCondition: string | null;
      confirmationDeadline: string | null;
      updatedAt: string;
      reminders: Array<{ id: string; type: string; description: string; dueAt: string | null }>;
    }>;
  }>("/portal/me/applications");
}

export function getPortalConfirmations() {
  return apiClient.request<{
    items: Array<{
      id: string;
      objectType: string;
      prompt: string;
      status: string;
      responseNote: string | null;
      respondedAt: string | null;
      dueAt: string | null;
    }>;
  }>("/portal/me/confirmations");
}

export function respondPortalConfirmation(
  confirmationId: string,
  status: "CONFIRMED" | "DECLINED",
  note?: string,
) {
  return apiClient.request(`/portal/me/confirmations/${confirmationId}`, {
    method: "POST",
    body: JSON.stringify({ status, note: note || null }),
  });
}
