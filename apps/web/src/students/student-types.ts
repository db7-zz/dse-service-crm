export interface StudentPerson {
  id: string;
  displayName: string;
}

export interface ResponsiblePersonOption extends StudentPerson {
  roleCodes: string[];
}

export interface ResponsiblePersonOptions {
  butlers: ResponsiblePersonOption[];
  planners: ResponsiblePersonOption[];
}

export interface StudentRecord {
  id: string;
  studentNo: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  defaultButler: StudentPerson | null;
  planner?: StudentPerson | null;
  serviceStatus: "NOT_ENABLED" | "ENABLED";
  version: number;
  createdBy?: StudentPerson;
  createdAt: string;
  updatedAt: string;
  progress?: StudentProgressSummary | null;
}

export interface StudentProgressSummary {
  calculationStatus: "NORMAL" | "RECALCULATING" | "ERROR";
  calculationErrorCode: string | null;
  lastCalculatedAt: string | null;
  progressVersion: number;
  completedStageCount: number;
  totalStageCount: 8;
  currentStage: null | {
    id: string;
    code: string;
    name: string;
    sequenceNo: number;
    status: "IN_PROGRESS";
    version: number;
  };
  currentBlockingTaskCount: number;
  overdueTaskCount: number;
  legacyTaskCount: number;
  taskCompletionRate: number | null;
}

export interface StudentResponsibilityHistory {
  id: string;
  responsibilityType: "DEFAULT_BUTLER" | "PLANNER";
  previousUser: StudentPerson | null;
  newUser: StudentPerson | null;
  reason: string;
  operator: StudentPerson;
  createdAt: string;
}

export interface StudentDetail extends StudentRecord {
  activation: null | {
    id: string;
    enabledAt: string;
    enabledBy: StudentPerson;
  };
  sopVersion: null | {
    id: string;
    versionNo: number;
    displayVersion: string;
    status: "DRAFT" | "PUBLISHED" | "RETIRED";
  };
  taskSummary: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    canceled: number;
    overdue: number;
    unassigned: number;
    completionRate: number | null;
  };
  progress: StudentProgressSummary | null;
  stages: Array<{
    id: string;
    stageCode: string;
    name: string;
    sequenceNo: number;
    description: string | null;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    startedAt: string | null;
    completedAt: string | null;
    completionReason: string | null;
    version: number;
    openBlockingTaskCount: number;
    transitions: Array<{
      id: string;
      fromStatus: "NOT_STARTED" | "IN_PROGRESS" | null;
      toStatus: "IN_PROGRESS" | "COMPLETED";
      triggerType: string;
      summary: string;
      triggerTask: { id: string; title: string } | null;
      calculationRun: { id: string; type: "MIGRATION" | "RECALCULATION" } | null;
      createdAt: string;
    }>;
    tasks: Array<{
      id: string;
      title: string;
      sequenceNo: number | null;
      sourceType: "SOP" | "MANUAL";
      isBlocking: boolean;
      isLegacy: boolean;
      status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
      owner: StudentPerson | null;
      currentDueAt: string;
      isOverdue: boolean;
      version: number;
    }>;
  }>;
  responsibilityHistory: StudentResponsibilityHistory[];
}

export interface StudentServiceProgress {
  student: Pick<StudentRecord, "id" | "studentNo" | "name">;
  serviceStatus: StudentRecord["serviceStatus"];
  activation: StudentDetail["activation"];
  sopVersion: StudentDetail["sopVersion"];
  taskSummary: StudentDetail["taskSummary"];
  progress: StudentDetail["progress"];
  stages: StudentDetail["stages"];
}

export interface StudentPageData {
  items: StudentRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export interface StudentFormValues {
  name: string;
  phone?: string;
  email?: string;
  defaultButlerId?: string;
  plannerId?: string;
}
