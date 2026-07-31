import { describe, expect, it } from "vitest";
import { formatOverdueDuration } from "./task-format";

describe("formatOverdueDuration", () => {
  const dueAt = "2026-07-31T00:00:00.000Z";
  const dueAtMs = new Date(dueAt).getTime();

  it("uses strict overdue boundaries and the under-one-hour label", () => {
    expect(formatOverdueDuration(dueAt, dueAtMs)).toBeNull();
    expect(formatOverdueDuration(dueAt, dueAtMs + 59 * 60 * 1000)).toBe("不足1小时");
    expect(formatOverdueDuration(dueAt, dueAtMs + 60 * 60 * 1000)).toBe("1小时");
  });

  it("floors complete hours and switches to the day-hour format", () => {
    expect(formatOverdueDuration(dueAt, dueAtMs + 23.9 * 60 * 60 * 1000)).toBe("23小时");
    expect(formatOverdueDuration(dueAt, dueAtMs + 24 * 60 * 60 * 1000)).toBe("1天0小时");
    expect(formatOverdueDuration(dueAt, dueAtMs + 50.5 * 60 * 60 * 1000)).toBe("2天2小时");
  });
});
