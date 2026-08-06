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
}

export interface MaterialItemView {
  id: string;
  studentId: string;
  materialType: { id: string; code: string; name: string; isCore: boolean };
  title: string;
  requirement: string | null;
  dueAt: string | null;
  status: string;
  missingReason: string | null;
  expectedSubmitAt: string | null;
  owner: PersonRef | null;
  version: number;
  currentVersion: MaterialVersionView | null;
  versions: MaterialVersionView[];
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
