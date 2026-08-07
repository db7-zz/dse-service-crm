const DRAFTABLE_MATERIAL_STATUSES = new Set([
  "REQUIRED",
  "PARTIALLY_MISSING",
  "RESUBMISSION_REQUIRED",
  "AWAITING_CONFIRMATION",
  "NEEDS_CORRECTION",
]);

export function canCreateMaterialSubmissionDraft(
  materialStatus: string,
  hasPendingApplicabilityRequest: boolean,
) {
  return DRAFTABLE_MATERIAL_STATUSES.has(materialStatus) && !hasPendingApplicabilityRequest;
}

export type MaterialSubmissionReviewAccess =
  "ALLOWED" | "NOT_RESPONSIBLE_REVIEWER" | "SELF_REVIEW" | "ADMIN_REVIEW_REQUIRED";

export function materialSubmissionReviewAccess(input: {
  isAdministrator: boolean;
  isResponsibleButler: boolean;
  isUploader: boolean;
  source: "STUDENT" | "BUTLER" | "LEGACY";
}): MaterialSubmissionReviewAccess {
  if (!input.isAdministrator && !input.isResponsibleButler) {
    return "NOT_RESPONSIBLE_REVIEWER";
  }
  if (input.isUploader) return "SELF_REVIEW";
  if (input.source === "BUTLER" && !input.isAdministrator) {
    return "ADMIN_REVIEW_REQUIRED";
  }
  return "ALLOWED";
}

export function materialSubmissionReviewCoverageError(input: {
  pendingFileIds: string[];
  decisions: Array<{ fileId: string; outcome: "APPROVED" | "CORRECTION_REQUIRED" }>;
  outcome: "APPROVED" | "NEEDS_CORRECTION";
}) {
  const pending = new Set(input.pendingFileIds);
  const decided = new Set(input.decisions.map((decision) => decision.fileId));
  if (
    decided.size !== input.decisions.length ||
    decided.size !== pending.size ||
    [...pending].some((fileId) => !decided.has(fileId))
  ) {
    return "INCOMPLETE_FILE_DECISIONS" as const;
  }
  const correctionCount = input.decisions.filter(
    (decision) => decision.outcome === "CORRECTION_REQUIRED",
  ).length;
  if (
    (input.outcome === "APPROVED" && correctionCount > 0) ||
    (input.outcome === "NEEDS_CORRECTION" && correctionCount === 0)
  ) {
    return "OUTCOME_MISMATCH" as const;
  }
  return null;
}
