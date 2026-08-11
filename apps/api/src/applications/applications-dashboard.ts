import type { ApplicationStatus } from "@dse/database";

export const APPLICATION_STAGE_CODES = [
  "PREPARING",
  "PENDING_SUBMISSION",
  "SUBMITTED",
  "ACTION_REQUIRED",
  "ADMITTED",
  "CLOSED",
] as const;

export const APPLICATION_RISK_CODES = [
  "PENDING_EVIDENCE",
  "MISSING_DEADLINE",
  "OVERDUE",
  "DUE_7_DAYS",
  "DUE_14_DAYS",
] as const;

export type ApplicationStageCode = (typeof APPLICATION_STAGE_CODES)[number];
export type ApplicationRiskCode = (typeof APPLICATION_RISK_CODES)[number];
export type ApplicationAttentionCode = ApplicationRiskCode | "ACTION_REQUIRED";

export interface DashboardApplicationRecord {
  id: string;
  studentId: string;
  channel: "HK_DIRECT" | "JUPAS";
  institutionName: string;
  programName: string | null;
  applicationNo: string | null;
  deadlineMode: "FIXED" | "ROLLING" | "UNKNOWN";
  deadlineAt: Date | null;
  confirmationDeadline: Date | null;
  status: ApplicationStatus;
  updatedAt: Date;
  student: {
    id: string;
    studentNo: string;
    name: string;
  };
  owner: { id: string; displayName: string } | null;
  requirements: Array<{
    id: string;
    requirementType: string;
    description: string;
    dueAt: Date | null;
    status: "OPEN" | "COMPLETED" | "WAIVED";
  }>;
}

export interface ApplicationAttention {
  code: ApplicationAttentionCode;
  rank: number;
  reason: string;
  deadlineAt: Date | null;
  daysRemaining: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRE_SUBMISSION_STATUSES = new Set<ApplicationStatus>([
  "PLANNING",
  "CONFIRMED",
  "MATERIAL_PREPARATION",
  "PENDING_SUBMISSION",
]);
const KEY_ACTION_STATUSES = new Set<ApplicationStatus>([
  "PENDING_SUBMISSION",
  "SUPPLEMENT",
  "INTERVIEW",
  "OFFER",
]);
const KEY_REQUIREMENT_TYPES = new Set(["SUPPLEMENT", "INTERVIEW", "OFFER_CONFIRMATION"]);
const TERMINAL_STATUSES = new Set<ApplicationStatus>(["REJECTED", "ENROLLED", "WITHDRAWN"]);

export function applicationStage(status: ApplicationStatus): ApplicationStageCode {
  if (["PLANNING", "CONFIRMED", "MATERIAL_PREPARATION"].includes(status)) return "PREPARING";
  if (["PENDING_SUBMISSION", "SUBMISSION_PENDING_EVIDENCE"].includes(status)) {
    return "PENDING_SUBMISSION";
  }
  if (["SUBMITTED", "WAITING_RESULT", "WAITLISTED"].includes(status)) return "SUBMITTED";
  if (["SUPPLEMENT", "INTERVIEW"].includes(status)) return "ACTION_REQUIRED";
  if (["OFFER", "ENROLLED"].includes(status)) return "ADMITTED";
  return "CLOSED";
}

export function applicationAttention(
  application: DashboardApplicationRecord,
  now: Date,
): ApplicationAttention | null {
  if (TERMINAL_STATUSES.has(application.status)) return null;

  const deadlineCandidates: Array<{ deadlineAt: Date; reason: string }> = [];
  if (PRE_SUBMISSION_STATUSES.has(application.status) && application.deadlineAt) {
    deadlineCandidates.push({ deadlineAt: application.deadlineAt, reason: "申请截止" });
  }
  if (application.status === "OFFER" && application.confirmationDeadline) {
    deadlineCandidates.push({
      deadlineAt: application.confirmationDeadline,
      reason: "Offer 确认截止",
    });
  }
  for (const requirement of application.requirements) {
    if (requirement.status !== "OPEN" || !requirement.dueAt) continue;
    deadlineCandidates.push({
      deadlineAt: requirement.dueAt,
      reason: requirement.description || requirementTypeLabel(requirement.requirementType),
    });
  }

  const deadlineAttention = deadlineCandidates
    .map((candidate) => attentionForDeadline(candidate.deadlineAt, candidate.reason, now))
    .filter((candidate): candidate is ApplicationAttention => Boolean(candidate))
    .sort(compareAttention)[0];
  if (deadlineAttention?.code === "OVERDUE") return deadlineAttention;

  if (application.status === "SUBMISSION_PENDING_EVIDENCE") {
    return {
      code: "PENDING_EVIDENCE",
      rank: 1,
      reason: "已操作，等待补充可留存的递交凭证",
      deadlineAt: null,
      daysRemaining: null,
    };
  }

  if (isMissingKeyDeadline(application)) {
    return {
      code: "MISSING_DEADLINE",
      rank: 2,
      reason: missingDeadlineLabel(application.status),
      deadlineAt: null,
      daysRemaining: null,
    };
  }

  if (deadlineAttention) return deadlineAttention;

  const openKeyRequirement = application.requirements.find(
    (requirement) =>
      requirement.status === "OPEN" && KEY_REQUIREMENT_TYPES.has(requirement.requirementType),
  );
  if (KEY_ACTION_STATUSES.has(application.status) || openKeyRequirement) {
    return {
      code: "ACTION_REQUIRED",
      rank: 5,
      reason: openKeyRequirement?.description || actionStatusLabel(application.status),
      deadlineAt: relevantDeadline(application),
      daysRemaining: daysFromNow(relevantDeadline(application), now),
    };
  }

  return null;
}

export function relevantDeadline(application: DashboardApplicationRecord): Date | null {
  const requirementDeadline = application.requirements
    .filter((requirement) => requirement.status === "OPEN" && requirement.dueAt)
    .map((requirement) => requirement.dueAt as Date)
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (application.status === "OFFER") {
    return application.confirmationDeadline ?? requirementDeadline ?? application.deadlineAt;
  }
  if (["SUPPLEMENT", "INTERVIEW"].includes(application.status)) {
    return requirementDeadline ?? null;
  }
  return application.deadlineAt ?? requirementDeadline ?? application.confirmationDeadline;
}

export function compareAttention(left: ApplicationAttention, right: ApplicationAttention) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.deadlineAt && right.deadlineAt) {
    return left.deadlineAt.getTime() - right.deadlineAt.getTime();
  }
  if (left.deadlineAt) return -1;
  if (right.deadlineAt) return 1;
  return left.reason.localeCompare(right.reason, "zh-CN");
}

function attentionForDeadline(
  deadlineAt: Date,
  reason: string,
  now: Date,
): ApplicationAttention | null {
  const difference = deadlineAt.getTime() - now.getTime();
  if (difference < 0) {
    return {
      code: "OVERDUE",
      rank: 0,
      reason,
      deadlineAt,
      daysRemaining: daysFromNow(deadlineAt, now),
    };
  }
  if (difference <= 7 * DAY_MS) {
    return {
      code: "DUE_7_DAYS",
      rank: 3,
      reason,
      deadlineAt,
      daysRemaining: daysFromNow(deadlineAt, now),
    };
  }
  if (difference <= 14 * DAY_MS) {
    return {
      code: "DUE_14_DAYS",
      rank: 4,
      reason,
      deadlineAt,
      daysRemaining: daysFromNow(deadlineAt, now),
    };
  }
  return null;
}

function isMissingKeyDeadline(application: DashboardApplicationRecord) {
  if (application.status === "PENDING_SUBMISSION") {
    return application.deadlineMode === "UNKNOWN";
  }
  if (application.status === "OFFER") return !application.confirmationDeadline;
  if (["SUPPLEMENT", "INTERVIEW"].includes(application.status)) {
    const expectedType = application.status;
    return !application.requirements.some(
      (requirement) =>
        requirement.status === "OPEN" &&
        requirement.requirementType === expectedType &&
        Boolean(requirement.dueAt),
    );
  }
  return false;
}

function missingDeadlineLabel(status: ApplicationStatus) {
  if (status === "PENDING_SUBMISSION") return "未设置申请截止时间";
  if (status === "SUPPLEMENT") return "未设置补件截止时间";
  if (status === "INTERVIEW") return "未设置面试时间";
  if (status === "OFFER") return "未设置 Offer 确认截止时间";
  return "未设置截止时间";
}

function actionStatusLabel(status: ApplicationStatus) {
  if (status === "PENDING_SUBMISSION") return "等待递交";
  if (status === "SUPPLEMENT") return "等待补件";
  if (status === "INTERVIEW") return "等待面试";
  if (status === "OFFER") return "等待确认 Offer";
  return "需要跟进";
}

function requirementTypeLabel(type: string) {
  return (
    {
      SUPPLEMENT: "申请补件",
      INTERVIEW: "申请面试",
      OFFER_CONFIRMATION: "Offer 确认",
      ESSAY: "申请文书",
      OTHER: "申请节点待办",
    }[type] ?? "申请节点待办"
  );
}

function daysFromNow(deadlineAt: Date | null, now: Date) {
  if (!deadlineAt) return null;
  const difference = deadlineAt.getTime() - now.getTime();
  return difference >= 0
    ? Math.ceil(difference / DAY_MS)
    : -Math.ceil(Math.abs(difference) / DAY_MS);
}
