import { apiClient } from "../auth/api";
import type {
  RectificationPage,
  RectificationRecord,
  RectificationStatus,
} from "./rectification-types";

export function listRectifications(input: {
  status?: RectificationStatus;
  butlerId?: string;
  mine?: boolean;
  pageSize?: number;
}) {
  const query = new URLSearchParams({ page: "1", pageSize: String(input.pageSize ?? 100) });
  if (input.status) query.set("status", input.status);
  if (input.butlerId) query.set("butlerId", input.butlerId);
  return apiClient.request<RectificationPage>(
    `${input.mine ? "/my/rectifications" : "/admin/rectifications"}?${query.toString()}`,
  );
}

export function createRectification(input: {
  butlerId: string;
  taskIds: string[];
  issueIds: string[];
  summary: string;
  dueAt: string;
}) {
  return apiClient.request<RectificationRecord>("/admin/rectifications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function reviewRectification(input: {
  id: string;
  version: number;
  approve: boolean;
  note: string;
}) {
  return apiClient.request<RectificationRecord>(`/admin/rectifications/${input.id}/review`, {
    method: "POST",
    body: JSON.stringify({ version: input.version, approve: input.approve, note: input.note }),
  });
}

export function submitRectification(input: { id: string; version: number; note: string }) {
  return apiClient.request<RectificationRecord>(`/my/rectifications/${input.id}/submit`, {
    method: "POST",
    body: JSON.stringify({ version: input.version, note: input.note }),
  });
}
