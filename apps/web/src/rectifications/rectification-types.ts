export type RectificationStatus = "PENDING_RECTIFICATION" | "PENDING_REVIEW" | "CLOSED";

export interface RectificationRecord {
  id: string;
  butler: { id: string; displayName: string };
  createdBy: { id: string; displayName: string };
  summary: string;
  dueAt: string;
  status: RectificationStatus;
  responseNote: string | null;
  submittedAt: string | null;
  reviewNote: string | null;
  reviewedBy: { id: string; displayName: string } | null;
  reviewedAt: string | null;
  closedAt: string | null;
  version: number;
  items: Array<{
    id: string;
    title: string;
    type: "TASK" | "ISSUE";
    task: null | {
      id: string;
      title: string;
      status: string;
      dueAt: string;
      student: { id: string; studentNo: string; name: string };
    };
    issue: null | {
      id: string;
      category: string;
      status: string;
      dueAt: string | null;
      student: { id: string; studentNo: string; name: string };
    };
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface RectificationPage {
  items: RectificationRecord[];
  page: number;
  pageSize: number;
  total: number;
}
