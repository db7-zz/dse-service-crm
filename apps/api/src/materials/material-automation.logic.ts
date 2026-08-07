const DAY_MS = 24 * 60 * 60 * 1000;

const CORRECTION_STATUSES = new Set([
  "NEEDS_CORRECTION",
  "PARTIALLY_MISSING",
  "RESUBMISSION_REQUIRED",
]);

export const AUTOMATED_DEADLINE_STATUSES = [
  "REQUIRED",
  "DRAFT",
  "NEEDS_CORRECTION",
  "PARTIALLY_MISSING",
  "RESUBMISSION_REQUIRED",
  "AWAITING_CONFIRMATION",
] as const;

export type DeadlineReminderMilestone = 1 | 3 | 7;
export type OverdueReminderMilestone = 0 | 3 | 7;
export type ReviewSlaMilestone = 24 | 72;

export function effectiveMaterialDeadline(input: {
  status: string;
  dueAt: Date | null;
  correctionDueAt: Date | null;
  expectedSubmitAt: Date | null;
}) {
  if (CORRECTION_STATUSES.has(input.status)) {
    return input.correctionDueAt ?? input.expectedSubmitAt ?? input.dueAt;
  }
  return input.dueAt;
}

export function upcomingDeadlineMilestone(
  deadline: Date,
  now: Date,
): DeadlineReminderMilestone | null {
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0 || remaining > 7 * DAY_MS) return null;
  if (remaining <= DAY_MS) return 1;
  if (remaining <= 3 * DAY_MS) return 3;
  return 7;
}

export function overdueDeadlineMilestone(
  deadline: Date,
  now: Date,
): OverdueReminderMilestone | null {
  const overdueFor = now.getTime() - deadline.getTime();
  if (overdueFor < 0) return null;
  if (overdueFor >= 7 * DAY_MS) return 7;
  if (overdueFor >= 3 * DAY_MS) return 3;
  return 0;
}

export function reviewSlaMilestone(submittedAt: Date, now: Date): ReviewSlaMilestone | null {
  const waitingFor = now.getTime() - submittedAt.getTime();
  if (waitingFor < DAY_MS) return null;
  return waitingFor >= 3 * DAY_MS ? 72 : 24;
}
