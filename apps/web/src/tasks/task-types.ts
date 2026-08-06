export type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | "NOT_APPLICABLE";
export type AlertStatus = "OPEN" | "HANDLED" | "RESOLVED";

export interface TaskPerson {
  id: string;
  displayName: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  status: TaskStatus;
  progressPercent: number | null;
  student: {
    id: string;
    studentNo: string;
    name: string;
  };
  stage: {
    id: string;
    code: string;
    name: string;
    sequenceNo: number;
  };
  taskSequenceNo: number | null;
  sourceType: "SOP" | "MANUAL" | "MATERIAL" | "APPLICATION" | "ISSUE";
  sourceObjectId: string | null;
  isBlocking: boolean;
  evidenceRequired: boolean;
  externalVisible: boolean;
  owner: TaskPerson | null;
  originalDueAt: string;
  currentDueAt: string;
  startedAt: string | null;
  completedAt: string | null;
  isOverdue: boolean;
  activeAlert: null | {
    id: string;
    status: "OPEN" | "HANDLED";
    episode: number;
  };
  latestExtension: null | {
    reason: string;
    expectedFinishAt: string;
    reportedAt: string;
  };
  sopVersion: {
    id: string;
    versionNo: number;
    displayVersion: string;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskTimelineItem {
  id: string;
  eventType: string;
  actor: TaskPerson | null;
  actorRole: string | null;
  summary: string;
  reason: string | null;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}

export interface TaskDetail extends TaskListItem {
  description: string | null;
  completionCriteria: string | null;
  completionWindowHours: number | null;
  completionNote: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
  evidence: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    fileHash: string;
    uploadedBy: TaskPerson;
    createdAt: string;
  }>;
  progressRecords: Array<{
    id: string;
    note: string;
    percent: number | null;
    createdBy: TaskPerson;
    createdAt: string;
  }>;
  extensionReports: Array<{
    id: string;
    reason: string;
    expectedFinishAt: string;
    reportedBy: TaskPerson;
    reportedAt: string;
  }>;
  studentBlockers: Array<{
    id: string;
    category: string;
    description: string;
    expectedRecoveryAt: string;
    reportedAt: string;
    reportedInTime: boolean;
    status: "ACTIVE" | "SUPERSEDED" | "RESOLVED" | "REJECTED";
    reportedBy: TaskPerson;
    reviewedBy: TaskPerson | null;
    reviewedAt: string | null;
    reviewNote: string | null;
  }>;
  dueDateChanges: Array<{
    id: string;
    oldDueAt: string;
    newDueAt: string;
    reason: string;
    operator: TaskPerson;
    createdAt: string;
  }>;
  reassignments: Array<{
    id: string;
    oldOwner: TaskPerson | null;
    newOwner: TaskPerson;
    reason: string;
    operator: TaskPerson;
    createdAt: string;
  }>;
  overdueAlerts: Array<{
    id: string;
    episode: number;
    status: AlertStatus;
    firstOverdueAt: string;
    generatedAt: string;
    handledAt: string | null;
    resolvedAt: string | null;
    resolvedReason: string | null;
  }>;
  timeline: TaskTimelineItem[];
  stageChanged?: boolean;
  completedStageCount?: number;
  progressVersion?: number;
  advancedStages?: Array<{
    id: string;
    code: string;
    name: string;
    sequenceNo: number;
  }>;
}

export interface TaskPage {
  items: TaskListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SupervisionSummary {
  taskCount: number;
  inProgress: number;
  overdue: number;
  unassigned: number;
  openAlerts: number;
}

export type SupervisionAttentionReason = "OVERDUE" | "OPEN_ALERT" | "UNASSIGNED" | "DUE_SOON";

export interface SupervisionFocusTask extends TaskListItem {
  attentionReasons: SupervisionAttentionReason[];
  lastFollowUpAt: string | null;
}

export interface SupervisionFocusStudent {
  student: TaskListItem["student"];
  taskCount: number;
  attentionCount: number;
  overdueCount: number;
  openAlertCount: number;
  unassignedCount: number;
  staleCount: number;
  dueSoonCount: number;
  nearestDueAt: string;
  lastFollowUpAt: string | null;
  owners: TaskPerson[];
  tasks: SupervisionFocusTask[];
}

export interface SupervisionFocusPage {
  items: SupervisionFocusStudent[];
  page: number;
  pageSize: number;
  total: number;
  taskTotal: number;
}

export type ButlerWorkStatus = "NEEDS_ACTION" | "WATCH" | "NORMAL" | "IDLE";
export type ButlerAttentionReason = "OVERDUE" | "DUE_SOON";
export type ButlerRiskLevel = "URGENT" | "WARNING" | "REMINDER" | "NORMAL";

export interface ButlerDashboardItem {
  id: string;
  displayName: string;
  studentCount: number;
  activeTaskCount: number;
  todo: number;
  inProgress: number;
  completedLast7Days: number;
  overdue: number;
  overdueIssueCount: number;
  overdueRectificationCount: number;
  openAlerts: number;
  attentionCount: number;
  lastFollowUpAt: string | null;
  oldestOverdueAt: string | null;
  affectedStudents: Array<{ id: string; studentNo: string; name: string }>;
  activeRectificationCount: number;
  riskLevel: ButlerRiskLevel;
  anomalies: Array<{
    type: "TASK" | "ISSUE";
    id: string;
    title: string;
    dueAt: string;
    student: { id: string; studentNo: string; name: string };
    isBlocking: boolean;
  }>;
  workStatus: ButlerWorkStatus;
}

export interface ButlerAttentionItem {
  taskId: string;
  title: string;
  reason: ButlerAttentionReason;
  owner: TaskPerson;
  student: {
    id: string;
    studentNo: string;
    name: string;
  };
  currentDueAt: string;
  lastFollowUpAt: string | null;
  openAlertCount: number;
}

export interface ButlerDashboard {
  summary: {
    butlerCount: number;
    studentCount: number;
    inProgress: number;
    attentionCount: number;
    abnormalButlerCount: number;
    pendingReviewCount: number;
  };
  items: ButlerDashboardItem[];
  attentionItems: ButlerAttentionItem[];
  generatedAt: string;
}

export interface OverdueAlertItem {
  id: string;
  episode: number;
  status: AlertStatus;
  firstOverdueAt: string;
  generatedAt: string;
  handledBy: TaskPerson | null;
  handledAt: string | null;
  resolvedAt: string | null;
  resolvedReason: string | null;
  task: TaskListItem;
}

export interface OverdueAlertPage {
  items: OverdueAlertItem[];
  page: number;
  pageSize: number;
  total: number;
}

export type ButlerAnomalyStatus = "OPEN" | "RECTIFIED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED";
export type ButlerWeeklyReviewStatus = "LIVE" | "PENDING_RESPONSE" | "PENDING_REVIEW" | "CLOSED";

export interface ButlerAnomaly {
  id: string;
  type:
    | "TASK_OVERDUE_UNREPORTED"
    | "STUDENT_BLOCKER_FOLLOWUP_MISSED"
    | "STUDENT_BLOCKER_REJECTED"
    | "WEEKLY_RESPONSE_OVERDUE";
  status: ButlerAnomalyStatus;
  title: string;
  occurredAt: string;
  deadline: string | null;
  student: { id: string; studentNo: string; name: string } | null;
  task: { id: string; title: string; status: TaskStatus; currentDueAt: string } | null;
  blocker: null | {
    id: string;
    category: string;
    description: string;
    expectedRecoveryAt: string;
    reportedAt: string;
    reportedInTime: boolean;
    status: "ACTIVE" | "SUPERSEDED" | "RESOLVED" | "REJECTED";
    reviewNote: string | null;
  };
  factDetail: unknown;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface ButlerWeeklyReview {
  id: string;
  butler: TaskPerson;
  weekStart: string;
  weekEnd: string;
  status: ButlerWeeklyReviewStatus;
  frozenAt: string | null;
  responseDueAt: string | null;
  submittedAt: string | null;
  reviewedBy: TaskPerson | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  version: number;
  items: Array<{
    id: string;
    itemKind: "NEW" | "CARRIED";
    responseNote: string | null;
    respondedAt: string | null;
    anomaly: ButlerAnomaly;
  }>;
}

export interface ButlerSupervisionDashboard {
  selectedWeek: { weekStart: string; weekEnd: string; frozen: boolean };
  summary: {
    total: number;
    newCount: number;
    carriedCount: number;
    affectedButlerCount: number;
    pendingVerificationCount: number;
  };
  trend: Array<{
    weekStart: string;
    weekEnd: string;
    total: number;
    newCount: number;
    carriedCount: number;
  }>;
  items: Array<{
    id: string;
    displayName: string;
    total: number;
    newCount: number;
    carriedCount: number;
    openCount: number;
    oldestOccurredAt: string | null;
    affectedStudents: Array<{ id: string; studentNo: string; name: string }>;
    review: ButlerWeeklyReview | null;
    anomalies: ButlerAnomaly[];
    pendingBlockers: Array<{
      id: string;
      category: string;
      description: string;
      expectedRecoveryAt: string;
      reportedAt: string;
      task: { id: string; title: string; currentDueAt: string };
      student: { id: string; studentNo: string; name: string };
    }>;
  }>;
  generatedAt: string;
}
