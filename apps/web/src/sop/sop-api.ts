import { apiClient } from "../auth/api";
import type {
  SopStageTemplate,
  SopValidationResult,
  SopVersion,
  SopVersionList,
} from "./sop-types";

export function listSopVersions() {
  return apiClient.request<SopVersionList>("/sop-versions");
}

export function createSopDraft() {
  return apiClient.request<SopVersion>("/sop-versions", { method: "POST" });
}

export function getSopVersion(versionId: string) {
  return apiClient.request<SopVersion>(`/sop-versions/${versionId}`);
}

export function saveSopDraft(versionId: string, version: number, stages: SopStageTemplate[]) {
  return apiClient.request<SopVersion>(`/sop-versions/${versionId}`, {
    method: "PATCH",
    body: JSON.stringify({
      version,
      stages: stages.map((stage) => ({
        stageCode: stage.stageCode,
        name: stage.name,
        description: stage.description,
        tasks: stage.tasks.map((task) => ({
          name: task.name,
          description: task.description,
          completionCriteria: task.completionCriteria,
          completionWindowHours: task.completionWindowHours,
          isBlocking: task.isBlocking,
        })),
      })),
    }),
  });
}

export function validateSopVersion(versionId: string) {
  return apiClient.request<SopValidationResult>(`/sop-versions/${versionId}/validate`, {
    method: "POST",
  });
}

export function publishSopVersion(versionId: string, version: number) {
  return apiClient.request<SopVersion>(`/sop-versions/${versionId}/publish`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });
}
