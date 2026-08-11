import { describe, expect, it } from "vitest";
import {
  applicationAttention,
  applicationStage,
  type DashboardApplicationRecord,
} from "./applications-dashboard.js";

const NOW = new Date("2026-08-07T08:00:00.000Z");

describe("application dashboard rules", () => {
  it("groups exact statuses into the six confirmed business stages", () => {
    expect(applicationStage("PLANNING")).toBe("PREPARING");
    expect(applicationStage("MATERIAL_PREPARATION")).toBe("PREPARING");
    expect(applicationStage("PENDING_SUBMISSION")).toBe("PENDING_SUBMISSION");
    expect(applicationStage("WAITING_RESULT")).toBe("SUBMITTED");
    expect(applicationStage("INTERVIEW")).toBe("ACTION_REQUIRED");
    expect(applicationStage("ENROLLED")).toBe("ADMITTED");
    expect(applicationStage("WITHDRAWN")).toBe("CLOSED");
  });

  it("orders overdue, evidence, missing, seven-day, and fourteen-day risks by severity", () => {
    const overdue = applicationAttention(
      record({ status: "PENDING_SUBMISSION", deadlineAt: offsetDays(-2) }),
      NOW,
    );
    const missing = applicationAttention(
      record({ status: "PENDING_SUBMISSION", deadlineAt: null, deadlineMode: "UNKNOWN" }),
      NOW,
    );
    const dueSeven = applicationAttention(
      record({ status: "PENDING_SUBMISSION", deadlineAt: offsetDays(4) }),
      NOW,
    );
    const dueFourteen = applicationAttention(
      record({ status: "PENDING_SUBMISSION", deadlineAt: offsetDays(10) }),
      NOW,
    );

    expect(overdue).toMatchObject({ code: "OVERDUE", rank: 0, daysRemaining: -2 });
    const pendingEvidence = applicationAttention(
      record({ status: "SUBMISSION_PENDING_EVIDENCE" }),
      NOW,
    );

    expect(pendingEvidence).toMatchObject({ code: "PENDING_EVIDENCE", rank: 1 });
    expect(missing).toMatchObject({ code: "MISSING_DEADLINE", rank: 2 });
    expect(dueSeven).toMatchObject({ code: "DUE_7_DAYS", rank: 3, daysRemaining: 4 });
    expect(dueFourteen).toMatchObject({
      code: "DUE_14_DAYS",
      rank: 4,
      daysRemaining: 10,
    });

    const missingWithAnotherDueItem = applicationAttention(
      record({
        status: "PENDING_SUBMISSION",
        deadlineMode: "UNKNOWN",
        requirements: [
          {
            id: "requirement-2",
            requirementType: "OTHER",
            description: "内部检查",
            dueAt: offsetDays(4),
            status: "OPEN",
          },
        ],
      }),
      NOW,
    );
    expect(missingWithAnotherDueItem).toMatchObject({
      code: "MISSING_DEADLINE",
      rank: 2,
    });
  });

  it("flags missing key deadlines and keeps distant action stages in the attention queue", () => {
    const supplementMissing = applicationAttention(record({ status: "SUPPLEMENT" }), NOW);
    const offerMissing = applicationAttention(record({ status: "OFFER" }), NOW);
    const interviewDistant = applicationAttention(
      record({
        status: "INTERVIEW",
        requirements: [
          {
            id: "requirement-1",
            requirementType: "INTERVIEW",
            description: "准备面试",
            dueAt: offsetDays(20),
            status: "OPEN",
          },
        ],
      }),
      NOW,
    );

    expect(supplementMissing).toMatchObject({
      code: "MISSING_DEADLINE",
      reason: "未设置补件截止时间",
    });
    expect(offerMissing).toMatchObject({
      code: "MISSING_DEADLINE",
      reason: "未设置 Offer 确认截止时间",
    });
    expect(interviewDistant).toMatchObject({ code: "ACTION_REQUIRED", rank: 5 });
  });

  it("uses open requirement deadlines as time risks even while waiting for a result", () => {
    const attention = applicationAttention(
      record({
        status: "WAITING_RESULT",
        requirements: [
          {
            id: "requirement-1",
            requirementType: "SUPPLEMENT",
            description: "补交成绩证明",
            dueAt: offsetDays(3),
            status: "OPEN",
          },
        ],
      }),
      NOW,
    );

    expect(attention).toMatchObject({
      code: "DUE_7_DAYS",
      reason: "补交成绩证明",
      daysRemaining: 3,
    });
  });
});

function record(overrides: Partial<DashboardApplicationRecord> = {}): DashboardApplicationRecord {
  return {
    id: "application-1",
    studentId: "student-1",
    channel: "HK_DIRECT",
    institutionName: "香港大学",
    programName: "Bachelor of Arts",
    applicationNo: null,
    deadlineMode: "FIXED",
    deadlineAt: null,
    confirmationDeadline: null,
    status: "PLANNING",
    updatedAt: NOW,
    student: { id: "student-1", studentNo: "DSE-2026-0001", name: "陈乐怡" },
    owner: null,
    requirements: [],
    ...overrides,
  };
}

function offsetDays(days: number) {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}
