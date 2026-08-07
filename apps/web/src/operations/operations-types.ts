export interface PersonRef {
  id: string;
  displayName: string;
}

export interface MaterialVersionView {
  id: string;
  versionNo: number;
  fileName: string;
  mimeType?: string;
  fileSize?: number;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewComment: string | null;
  uploadedAt: string;
  uploadedBy?: PersonRef;
  reviewedBy?: PersonRef | null;
  downloadUrl: string;
  previewUrl?: string | null;
}

export interface MaterialSubmissionFileView {
  id: string;
  submissionId?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy?: PersonRef;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  reviewedAt?: string | null;
  reviewedBy?: PersonRef | null;
  reviewComment: string | null;
  copiedFromFileId: string | null;
  removedAt?: string | null;
  removalReason?: string | null;
  downloadUrl: string;
  previewUrl?: string | null;
}

export interface MaterialSubmissionView {
  id: string;
  materialItemId?: string;
  submissionNo: number;
  status: "DRAFT" | "PENDING_REVIEW" | "IN_REVIEW" | "NEEDS_CORRECTION" | "APPROVED" | "WITHDRAWN";
  source: "STUDENT" | "BUTLER" | "LEGACY";
  createdBy?: PersonRef;
  submittedBy?: PersonRef | null;
  submissionReason: string | null;
  submittedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason?: string | null;
  reviewStartedBy?: PersonRef | null;
  reviewStartedAt: string | null;
  reviewedBy?: PersonRef | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  correctionDueAt: string | null;
  files: MaterialSubmissionFileView[];
}

export interface MaterialItemView {
  id: string;
  studentId: string;
  materialType: { id: string; code: string; name: string; isCore: boolean };
  sopMaterialTemplate: null | {
    id: string;
    templateKey: string;
    sequenceNo: number;
    stageTemplate: { stageCode: string; name: string; sequenceNo: number };
  };
  templateKeySnapshot: string | null;
  title: string;
  requirement: string | null;
  origin: "SOP_TEMPLATE" | "SPECIAL";
  requirementKind: "REQUIRED" | "CONDITIONAL" | "OPTIONAL";
  deadlineRule: "ACTIVATION_OFFSET" | "STAGE_OFFSET" | "FIXED_DATE" | null;
  deadlineOffsetDays: number | null;
  conditionMatched: boolean;
  dueAt: string | null;
  status: string;
  missingReason: string | null;
  expectedSubmitAt: string | null;
  correctionDueAt: string | null;
  owner: PersonRef | null;
  createdBy?: PersonRef | null;
  creationReason?: string | null;
  version: number;
  currentVersion: MaterialVersionView | null;
  versions: MaterialVersionView[];
  currentSubmission: MaterialSubmissionView | null;
  submissions: MaterialSubmissionView[];
  applicabilityRequests: Array<{
    id: string;
    reason: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    requestedBy: PersonRef;
    createdAt: string;
    reviewedBy: PersonRef | null;
    reviewedAt: string | null;
    reviewComment: string | null;
  }>;
}

export interface ApplicationView {
  id: string;
  student: { id: string; studentNo: string; name: string };
  channel: "HK_DIRECT" | "JUPAS";
  institutionName: string;
  programName: string | null;
  preferenceNo: number | null;
  roundName: string | null;
  deadlineAt: string | null;
  status: string;
  submittedAt: string | null;
  applicationNo: string | null;
  result: string | null;
  offerCondition: string | null;
  confirmationDeadline: string | null;
  owner: PersonRef | null;
  intakeDecision: string | null;
  version: number;
  isOverdue: boolean;
  statusLogs: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    note: string;
    operator: PersonRef;
    changedAt: string;
  }>;
  requirements: Array<{
    id: string;
    requirementType: string;
    description: string;
    dueAt: string | null;
    status: string;
    linkedTask: { id: string; title: string; status: string } | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface IssueView {
  id: string;
  student: { id: string; studentNo: string; name: string };
  linkedTask: { id: string; title: string; status: string } | null;
  convertedTask: { id: string; title: string; status: string; dueAt: string } | null;
  category: string;
  description: string;
  context: string;
  priority: string | null;
  owner: PersonRef | null;
  dueAt: string | null;
  isOverdue: boolean;
  status: string;
  submittedBy: PersonRef;
  submittedAt: string;
  managerResponse: string | null;
  respondedAt: string | null;
  version: number;
  logs: Array<{
    id: string;
    action: string;
    note: string | null;
    operator: PersonRef;
    createdAt: string;
  }>;
  updatedAt: string;
}

export interface NotificationView {
  id: string;
  eventType: string;
  title: string;
  content: string;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface StudentFullRecordView {
  id: string;
  studentNo: string;
  name: string;
  englishName: string | null;
  school: string | null;
  grade: string | null;
  cohortYear: number | null;
  phone: string | null;
  email: string | null;
  serviceStatus: "NOT_ENABLED" | "ENABLED" | "PAUSED" | "TERMINATED";
  nextMilestone: string | null;
  riskLevel: "NORMAL" | "ATTENTION" | "HIGH";
  riskNote: string | null;
  defaultButler: PersonRef | null;
  planner: PersonRef | null;
  version: number;
  scores: Array<{
    id: string;
    subjectName: string;
    scoreType: string;
    scoreValue: string;
    updatedAt: string;
  }>;
  targets: Array<{
    id: string;
    institutionName: string;
    programName: string | null;
    targetLevel: string;
    status: string;
    updatedAt: string;
  }>;
  progress: {
    completedStageCount: number;
    currentStage: { name: string; sequenceNo: number } | null;
  } | null;
  missingCoreMaterialCount: number;
  applications: Array<{
    id: string;
    institutionName: string;
    programName: string | null;
    status: string;
  }>;
  updatedAt: string;
}
