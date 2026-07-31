export type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
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
  taskSequenceNo: number;
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
  completionWindowHours: number;
  completionNote: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
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
