import { describe, expect, it } from "vitest";
import {
  canCreateMaterialSubmissionDraft,
  materialSubmissionReviewAccess,
  materialSubmissionReviewCoverageError,
} from "./material-submission.logic.js";

describe("material submission workflow rules", () => {
  it("only opens a draft from an actionable state without a pending applicability request", () => {
    expect(canCreateMaterialSubmissionDraft("REQUIRED", false)).toBe(true);
    expect(canCreateMaterialSubmissionDraft("NEEDS_CORRECTION", false)).toBe(true);
    expect(canCreateMaterialSubmissionDraft("PENDING_REVIEW", false)).toBe(false);
    expect(canCreateMaterialSubmissionDraft("REQUIRED", true)).toBe(false);
  });

  it("prevents self review and reserves butler proxy uploads for administrators", () => {
    expect(
      materialSubmissionReviewAccess({
        isAdministrator: false,
        isResponsibleButler: true,
        isUploader: true,
        source: "STUDENT",
      }),
    ).toBe("SELF_REVIEW");
    expect(
      materialSubmissionReviewAccess({
        isAdministrator: false,
        isResponsibleButler: true,
        isUploader: false,
        source: "BUTLER",
      }),
    ).toBe("ADMIN_REVIEW_REQUIRED");
    expect(
      materialSubmissionReviewAccess({
        isAdministrator: true,
        isResponsibleButler: false,
        isUploader: false,
        source: "BUTLER",
      }),
    ).toBe("ALLOWED");
  });

  it("requires exactly one decision for every pending file", () => {
    expect(
      materialSubmissionReviewCoverageError({
        pendingFileIds: ["a", "b"],
        decisions: [{ fileId: "a", outcome: "APPROVED" }],
        outcome: "APPROVED",
      }),
    ).toBe("INCOMPLETE_FILE_DECISIONS");
  });

  it("keeps the batch outcome consistent with per-file decisions", () => {
    expect(
      materialSubmissionReviewCoverageError({
        pendingFileIds: ["a"],
        decisions: [{ fileId: "a", outcome: "CORRECTION_REQUIRED" }],
        outcome: "APPROVED",
      }),
    ).toBe("OUTCOME_MISMATCH");
    expect(
      materialSubmissionReviewCoverageError({
        pendingFileIds: ["a"],
        decisions: [{ fileId: "a", outcome: "CORRECTION_REQUIRED" }],
        outcome: "NEEDS_CORRECTION",
      }),
    ).toBeNull();
  });
});
