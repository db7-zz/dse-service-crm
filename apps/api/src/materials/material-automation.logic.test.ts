import { describe, expect, it } from "vitest";
import {
  effectiveMaterialDeadline,
  overdueDeadlineMilestone,
  reviewSlaMilestone,
  upcomingDeadlineMilestone,
} from "./material-automation.logic.js";

const now = new Date("2026-08-07T04:00:00.000Z");

describe("material automation milestones", () => {
  it("uses the correction deadline only while the student is correcting material", () => {
    const dueAt = new Date("2026-08-14T04:00:00.000Z");
    const correctionDueAt = new Date("2026-08-09T04:00:00.000Z");

    const expectedSubmitAt = new Date("2026-08-11T04:00:00.000Z");

    expect(
      effectiveMaterialDeadline({
        status: "NEEDS_CORRECTION",
        dueAt,
        correctionDueAt,
        expectedSubmitAt,
      }),
    ).toBe(correctionDueAt);
    expect(
      effectiveMaterialDeadline({
        status: "PARTIALLY_MISSING",
        dueAt,
        correctionDueAt: null,
        expectedSubmitAt,
      }),
    ).toBe(expectedSubmitAt);
    expect(
      effectiveMaterialDeadline({ status: "REQUIRED", dueAt, correctionDueAt, expectedSubmitAt }),
    ).toBe(dueAt);
  });

  it("selects only the current 7, 3 or 1 day deadline bucket", () => {
    expect(upcomingDeadlineMilestone(new Date("2026-08-14T04:00:00.000Z"), now)).toBe(7);
    expect(upcomingDeadlineMilestone(new Date("2026-08-10T04:00:00.000Z"), now)).toBe(3);
    expect(upcomingDeadlineMilestone(new Date("2026-08-08T04:00:00.000Z"), now)).toBe(1);
    expect(upcomingDeadlineMilestone(new Date("2026-08-15T04:00:00.000Z"), now)).toBeNull();
  });

  it("escalates overdue material at day 0, day 3 and day 7", () => {
    expect(overdueDeadlineMilestone(new Date("2026-08-07T04:00:00.000Z"), now)).toBe(0);
    expect(overdueDeadlineMilestone(new Date("2026-08-04T04:00:00.000Z"), now)).toBe(3);
    expect(overdueDeadlineMilestone(new Date("2026-07-31T04:00:00.000Z"), now)).toBe(7);
    expect(overdueDeadlineMilestone(new Date("2026-08-08T04:00:00.000Z"), now)).toBeNull();
  });

  it("reminds reviewers after 24 hours and escalates after 72 hours", () => {
    expect(reviewSlaMilestone(new Date("2026-08-06T04:00:01.000Z"), now)).toBeNull();
    expect(reviewSlaMilestone(new Date("2026-08-06T04:00:00.000Z"), now)).toBe(24);
    expect(reviewSlaMilestone(new Date("2026-08-04T04:00:00.000Z"), now)).toBe(72);
  });
});
