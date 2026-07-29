import { describe, expect, it } from "vitest";
import { buildAuditDiff } from "./audit-diff.js";

describe("buildAuditDiff", () => {
  it("records only changed fields while preserving both values", () => {
    expect(
      buildAuditDiff(
        { displayName: "原姓名", status: "ACTIVE", roleCodes: ["BUTLER"] },
        { displayName: "新姓名", status: "ACTIVE", roleCodes: ["BUTLER", "PLANNER"] },
      ),
    ).toEqual({
      beforeData: {
        displayName: "原姓名",
        roleCodes: ["BUTLER"],
      },
      afterData: {
        displayName: "新姓名",
        roleCodes: ["BUTLER", "PLANNER"],
      },
    });
  });
});
