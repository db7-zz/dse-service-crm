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
  sopVersion: null | {
    id: string;
    version: string;
  };
  taskSummary: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    overdue: number;
    unassigned: number;
  };
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
