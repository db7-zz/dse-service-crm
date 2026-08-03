import { describe, expect, it } from "vitest";
import {
  deriveStageProgress,
  StageProgressFactsError,
  type StageProgressFact,
} from "./service-progress.logic.js";

function stages(overrides: Partial<Record<number, StageProgressFact["tasks"]>> = {}) {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `stage-${index + 1}`,
    sequenceNo: index + 1,
    tasks: overrides[index + 1] ?? [{ status: "TODO" as const, isBlocking: true }],
  }));
}

describe("deriveStageProgress", () => {
  it("keeps the first stage current while any blocking task is active", () => {
    const result = deriveStageProgress(
      stages({
        1: [
          { status: "COMPLETED", isBlocking: true },
          { status: "IN_PROGRESS", isBlocking: true },
          { status: "TODO", isBlocking: false },
        ],
      }),
    );
    expect(result.completedStageCount).toBe(0);
    expect(result.currentStageId).toBe("stage-1");
  });

  it("continuously advances through later stages completed ahead of time", () => {
    const terminal = [{ status: "COMPLETED" as const, isBlocking: true }];
    const result = deriveStageProgress(stages({ 1: terminal, 2: terminal, 3: terminal }));
    expect(result.completedStageCount).toBe(3);
    expect(result.currentStageId).toBe("stage-4");
    expect(result.stages.map((stage) => stage.status)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "IN_PROGRESS",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
      "NOT_STARTED",
    ]);
  });

  it("counts unfinished non-blocking work as legacy without stopping progress", () => {
    const result = deriveStageProgress(
      stages({
        1: [
          { status: "CANCELED", isBlocking: true },
          { status: "TODO", isBlocking: false },
        ],
      }),
    );
    expect(result.completedStageCount).toBe(1);
    expect(result.stages[0]?.legacyTaskCount).toBe(1);
    expect(result.currentStageId).toBe("stage-2");
  });

  it("treats completed and canceled blocking tasks as terminal", () => {
    const result = deriveStageProgress(
      stages({
        1: [
          { status: "COMPLETED", isBlocking: true },
          { status: "CANCELED", isBlocking: true },
        ],
      }),
    );
    expect(result.completedStageCount).toBe(1);
    expect(result.currentStageId).toBe("stage-2");
  });

  it("does not skip an incomplete earlier stage when later blockers finish early", () => {
    const result = deriveStageProgress(stages({ 3: [{ status: "COMPLETED", isBlocking: true }] }));
    expect(result.completedStageCount).toBe(0);
    expect(result.currentStageId).toBe("stage-1");
    expect(result.stages[2]?.status).toBe("NOT_STARTED");
  });

  it("returns no current stage after all eight stages complete", () => {
    const terminal = [{ status: "COMPLETED" as const, isBlocking: true }];
    const result = deriveStageProgress(
      stages(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, terminal]))),
    );
    expect(result.completedStageCount).toBe(8);
    expect(result.currentStageId).toBeNull();
  });

  it("rejects a stage with no blocking task", () => {
    expect(() =>
      deriveStageProgress(stages({ 4: [{ status: "TODO", isBlocking: false }] })),
    ).toThrow(StageProgressFactsError);
  });

  it("rejects missing or out-of-order stage snapshots", () => {
    expect(() => deriveStageProgress(stages().slice(0, 7))).toThrow(StageProgressFactsError);
    const outOfOrder = stages();
    outOfOrder[4] = { ...outOfOrder[4]!, sequenceNo: 8 };
    expect(() => deriveStageProgress(outOfOrder)).toThrow(StageProgressFactsError);
  });
});
