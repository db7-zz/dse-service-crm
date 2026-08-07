import { apiClient } from "../auth/api";
import type {
  SopMaterialBackfillPreview,
  SopMaterialBackfillResult,
  SopMaterialType,
  SopStageTemplate,
  SopValidationResult,
  SopVersion,
  SopVersionList,
} from "./sop-types";

export function listSopMaterialTypes() {
  return apiClient.request<SopMaterialType[]>("/material-types");
}

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
        materials: stage.materials.map((material) => ({
          templateKey: material.templateKey,
          materialTypeId: material.materialType.id,
          title: material.title,
          requirement: material.requirement,
          requirementKind: material.requirementKind,
          deadlineRule: material.deadlineRule,
          deadlineOffsetDays: material.deadlineOffsetDays,
          fixedDueAt: material.fixedDueAt,
          conditionRule: material.conditionRule,
        })),
      })),
    }),
  });
}

export function previewSopMaterialBackfill(versionId: string, studentIds?: string[]) {
  return apiClient.request<SopMaterialBackfillPreview>(
    `/sop-versions/${versionId}/material-backfill/preview`,
    {
      method: "POST",
      body: JSON.stringify(studentIds?.length ? { studentIds } : {}),
    },
  );
}

export function applySopMaterialBackfill(
  versionId: string,
  previewFingerprint: string,
  studentIds?: string[],
) {
  return apiClient.request<SopMaterialBackfillResult>(
    `/sop-versions/${versionId}/material-backfill/apply`,
    {
      method: "POST",
      body: JSON.stringify({ previewFingerprint, ...(studentIds?.length ? { studentIds } : {}) }),
    },
  );
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
