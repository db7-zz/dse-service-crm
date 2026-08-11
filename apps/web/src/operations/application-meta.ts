import type {
  ApplicationAttentionView,
  ApplicationRiskCode,
  ApplicationStageCode,
} from "./operations-types";

export const APPLICATION_STATUSES = [
  "PLANNING",
  "CONFIRMED",
  "MATERIAL_PREPARATION",
  "PENDING_SUBMISSION",
  "SUBMISSION_PENDING_EVIDENCE",
  "SUBMITTED",
  "WAITING_RESULT",
  "SUPPLEMENT",
  "INTERVIEW",
  "WAITLISTED",
  "OFFER",
  "REJECTED",
  "ENROLLED",
  "WITHDRAWN",
] as const;

export const STATUS_META: Record<string, { label: string; color: string }> = {
  PLANNING: { label: "规划中", color: "default" },
  CONFIRMED: { label: "已确认", color: "blue" },
  MATERIAL_PREPARATION: { label: "材料准备", color: "cyan" },
  PENDING_SUBMISSION: { label: "待递交", color: "geekblue" },
  SUBMISSION_PENDING_EVIDENCE: { label: "已操作，待补凭证", color: "orange" },
  SUBMITTED: { label: "已递交", color: "blue" },
  WAITING_RESULT: { label: "等待结果", color: "purple" },
  SUPPLEMENT: { label: "补件", color: "magenta" },
  INTERVIEW: { label: "面试", color: "purple" },
  WAITLISTED: { label: "候补", color: "gold" },
  OFFER: { label: "已获录取", color: "green" },
  REJECTED: { label: "未录取", color: "default" },
  ENROLLED: { label: "已入读", color: "success" },
  WITHDRAWN: { label: "已撤回", color: "default" },
};

export const STAGE_ORDER: ApplicationStageCode[] = [
  "PREPARING",
  "PENDING_SUBMISSION",
  "SUBMITTED",
  "ACTION_REQUIRED",
  "ADMITTED",
  "CLOSED",
];

export const STAGE_META: Record<ApplicationStageCode, { label: string; color: string }> = {
  PREPARING: { label: "准备中", color: "cyan" },
  PENDING_SUBMISSION: { label: "待递交", color: "geekblue" },
  SUBMITTED: { label: "已递交", color: "blue" },
  ACTION_REQUIRED: { label: "需动作", color: "purple" },
  ADMITTED: { label: "已获录取", color: "green" },
  CLOSED: { label: "未继续", color: "default" },
};

export const RISK_ORDER: ApplicationRiskCode[] = [
  "OVERDUE",
  "PENDING_EVIDENCE",
  "MISSING_DEADLINE",
  "DUE_7_DAYS",
  "DUE_14_DAYS",
];

export const RISK_META: Record<
  ApplicationRiskCode,
  { label: string; color: string; background: string; border: string }
> = {
  PENDING_EVIDENCE: {
    label: "待补递交凭证",
    color: "#c2410c",
    background: "#fff7ed",
    border: "#f97316",
  },
  MISSING_DEADLINE: {
    label: "缺少截止时间",
    color: "#c2410c",
    background: "#fff7ed",
    border: "#fb923c",
  },
  OVERDUE: {
    label: "已逾期",
    color: "#b91c1c",
    background: "#fef2f2",
    border: "#ef4444",
  },
  DUE_7_DAYS: {
    label: "0–7 天临期",
    color: "#c2410c",
    background: "#fff7ed",
    border: "#f97316",
  },
  DUE_14_DAYS: {
    label: "8–14 天预警",
    color: "#a16207",
    background: "#fefce8",
    border: "#eab308",
  },
};

export function channelLabel(channel: "HK_DIRECT" | "JUPAS") {
  return channel === "JUPAS" ? "JUPAS" : "港校直申";
}

export function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
}

export function attentionRelativeLabel(attention: ApplicationAttentionView | null) {
  if (!attention) return "暂无时间风险";
  if (attention.code === "PENDING_EVIDENCE") return "已操作，待补凭证";
  if (attention.code === "MISSING_DEADLINE") return "待补充截止时间";
  if (attention.code === "ACTION_REQUIRED") {
    return attention.daysRemaining === null ? "需要跟进" : relativeDays(attention.daysRemaining);
  }
  return relativeDays(attention.daysRemaining ?? 0);
}

function relativeDays(days: number) {
  if (days < 0) return `已逾期 ${Math.abs(days)} 天`;
  if (days === 0) return "今天截止";
  return `剩余 ${days} 天`;
}
