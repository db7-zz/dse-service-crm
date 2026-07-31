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
  phone: string | null;
  email: string | null;
  defaultButler: StudentPerson | null;
  planner: StudentPerson | null;
  serviceStatus: "NOT_ENABLED" | "ENABLED";
  version: number;
  createdBy: StudentPerson;
  createdAt: string;
  updatedAt: string;
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
    overdue: number;
    unassigned: number;
  };
  stages: Array<{
    id: string;
    stageCode: string;
    name: string;
    sequenceNo: number;
    description: string | null;
    tasks: Array<{
      id: string;
      title: string;
      sequenceNo: number;
      status: "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
      owner: StudentPerson | null;
      currentDueAt: string;
      isOverdue: boolean;
      version: number;
    }>;
  }>;
  responsibilityHistory: StudentResponsibilityHistory[];
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
