export type SopStatus = "DRAFT" | "PUBLISHED" | "RETIRED";

export interface SopTaskTemplate {
  id?: string;
  name: string;
  sequenceNo: number;
  description: string | null;
  completionCriteria: string | null;
  completionWindowHours: number;
  ownerRole: "BUTLER";
  isBlocking: boolean;
}

export interface SopStageTemplate {
  id?: string;
  stageCode: string;
  name: string;
  sequenceNo: number;
  description: string | null;
  tasks: SopTaskTemplate[];
}

export interface SopVersion {
  id: string;
  versionNo: number;
  displayVersion: string;
  status: SopStatus;
  sourceVersion: null | {
    id: string;
    versionNo: number;
    displayVersion: string;
  };
  publishedAt: string | null;
  createdBy: {
    id: string;
    displayName: string;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
  stageCount: number;
  taskCount: number;
  stages: SopStageTemplate[];
}

export interface SopVersionList {
  items: SopVersion[];
  currentPublishedVersionId: string | null;
  draftVersionId: string | null;
}

export interface SopValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string; code?: string }>;
  stageCount: number;
  taskCount: number;
}
