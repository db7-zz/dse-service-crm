import { describe, expect, it } from "vitest";
import {
  activationMissingRequirements,
  taskCompletionWindowSnapshot,
} from "./student-workflow.service.js";

describe("progressive student service activation rules", () => {
  it("requires a butler but does not require a planner before opening the student account", () => {
    expect(activationMissingRequirements({ defaultButlerId: null })).toEqual(["管家"]);
    expect(
      activationMissingRequirements({
        defaultButlerId: "00000000-0000-0000-0000-000000000001",
      }),
    ).toEqual([]);
  });

  it("stores completion-window snapshots only for SOP tasks", () => {
    expect(taskCompletionWindowSnapshot("SOP", 168)).toBe(168);
    expect(taskCompletionWindowSnapshot("MATERIAL", 168)).toBeNull();
    expect(taskCompletionWindowSnapshot("MANUAL", 24)).toBeNull();
  });
});
