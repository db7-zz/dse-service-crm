import { describe, expect, it } from "vitest";
import { calculateMaterialDueAt, matchesMaterialCondition } from "./material-template.logic.js";

const subject = {
  cohortYear: 2027,
  grade: "中六",
  identityCategory: "本地生",
  examCandidateType: "学校考生",
  targetDirection: "香港本科",
  dseSubjects: ["中文", "英文", "数学"],
};

describe("material template logic", () => {
  it("calculates activation, stage and fixed deadlines from the configured anchor", () => {
    const activationAt = new Date("2026-08-01T00:00:00.000Z");
    const stageStartedAt = new Date("2026-09-01T00:00:00.000Z");
    expect(
      calculateMaterialDueAt({
        rule: "ACTIVATION_OFFSET",
        offsetDays: 7,
        fixedDueAt: null,
        activationAt,
        stageStartedAt,
      })?.toISOString(),
    ).toBe("2026-08-08T00:00:00.000Z");
    expect(
      calculateMaterialDueAt({
        rule: "STAGE_OFFSET",
        offsetDays: 3,
        fixedDueAt: null,
        activationAt,
        stageStartedAt,
      })?.toISOString(),
    ).toBe("2026-09-04T00:00:00.000Z");
    expect(
      calculateMaterialDueAt({
        rule: "FIXED_DATE",
        offsetDays: null,
        fixedDueAt: new Date("2026-12-01T00:00:00.000Z"),
        activationAt,
        stageStartedAt,
      })?.toISOString(),
    ).toBe("2026-12-01T00:00:00.000Z");
  });

  it("does not invent a stage-relative deadline before the stage starts", () => {
    expect(
      calculateMaterialDueAt({
        rule: "STAGE_OFFSET",
        offsetDays: 3,
        fixedDueAt: null,
        activationAt: new Date("2026-08-01T00:00:00.000Z"),
        stageStartedAt: null,
      }),
    ).toBeNull();
  });

  it("matches only supported structured student conditions", () => {
    expect(
      matchesMaterialCondition({ field: "cohortYear", operator: "EQUALS", value: 2027 }, subject),
    ).toBe(true);
    expect(
      matchesMaterialCondition(
        { field: "dseSubjects", operator: "CONTAINS", value: ["英文", "数学"] },
        subject,
      ),
    ).toBe(true);
    expect(
      matchesMaterialCondition({ field: "unknown", operator: "EQUALS", value: "x" }, subject),
    ).toBe(false);
    expect(
      matchesMaterialCondition({ field: "grade", operator: "IN", value: "中六" }, subject),
    ).toBe(false);
    expect(
      matchesMaterialCondition({ field: "grade", operator: "EQUALS", value: ["中六"] }, subject),
    ).toBe(false);
  });
});
