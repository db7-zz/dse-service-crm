import { ErrorCode } from "@dse/shared";
import { describe, expect, it } from "vitest";
import { blockingStageValidationErrors } from "./sop-blocking.logic.js";

describe("blockingStageValidationErrors", () => {
  it("accepts a stage when at least one task blocks progress", () => {
    expect(
      blockingStageValidationErrors([
        {
          sequenceNo: 1,
          name: "建档阶段",
          tasks: [{ isBlocking: false }, { isBlocking: true }],
        },
      ]),
    ).toEqual([]);
  });

  it("returns a stage-addressable publish error for every stage without blockers", () => {
    expect(
      blockingStageValidationErrors([
        { sequenceNo: 2, name: "学情评估阶段", tasks: [] },
        { sequenceNo: 3, name: "升学规划阶段", tasks: [{ isBlocking: false }] },
      ]),
    ).toEqual([
      {
        path: "stages.2.tasks",
        code: ErrorCode.STAGE_BLOCKING_TASK_REQUIRED,
        message: "学情评估阶段至少需要一项阻塞任务",
      },
      {
        path: "stages.3.tasks",
        code: ErrorCode.STAGE_BLOCKING_TASK_REQUIRED,
        message: "升学规划阶段至少需要一项阻塞任务",
      },
    ]);
  });
});
