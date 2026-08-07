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

export interface SopMaterialType {
  id: string;
  code: string;
  name: string;
  isCore: boolean;
  inputMode?: "FILE" | "FORM" | "SECURE_REFERENCE";
}

export interface SopMaterialConditionRule {
  field:
    | "cohortYear"
    | "grade"
    | "identityCategory"
    | "examCandidateType"
    | "targetDirection"
    | "dseSubjects";
  operator: "EQUALS" | "IN" | "CONTAINS";
  value: string | number | Array<string | number>;
}

export interface SopMaterialTemplate {
  id?: string;
  templateKey?: string;
  materialType: SopMaterialType;
  title: string;
  requirement: string | null;
  requirementKind: "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
  deadlineRule: "ACTIVATION_OFFSET" | "STAGE_OFFSET" | "FIXED_DATE";
  deadlineOffsetDays: number | null;
  fixedDueAt: string | null;
  conditionRule: SopMaterialConditionRule | null;
  sequenceNo: number;
}

export interface SopStageTemplate {
  id?: string;
  stageCode: string;
  name: string;
  sequenceNo: number;
  description: string | null;
  tasks: SopTaskTemplate[];
  materials: SopMaterialTemplate[];
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
  materialCount: number;
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
  materialCount: number;
}

export interface SopMaterialBackfillPreview {
  sopVersionId: string;
  versionNo: number;
  previewFingerprint: string;
  studentCount: number;
  materialCount: number;
  students: Array<{
    id: string;
    studentNo: string;
    name: string;
    materialCount: number;
    materials: Array<{
      templateKey: string;
      title: string;
      materialTypeCode: string;
      stageCode: string;
      stageName: string;
      requirementKind: "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
      conditionMatched: boolean;
      dueAt: string | null;
      taskWillBeCreated: boolean;
    }>;
  }>;
  guarantees: {
    additiveOnly: boolean;
    overwritesExistingItems: boolean;
    deletesExistingItems: boolean;
  };
}

export interface SopMaterialBackfillResult {
  sopVersionId: string;
  versionNo: number;
  previewFingerprint: string;
  studentCount: number;
  materialCount: number;
  taskCount: number;
}
