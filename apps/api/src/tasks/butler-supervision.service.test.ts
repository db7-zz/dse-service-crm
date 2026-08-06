import { describe, expect, it } from "vitest";
import { hongKongWeekEnd, hongKongWeekStart } from "./butler-supervision.service.js";

describe("Hong Kong natural week boundaries", () => {
  it("starts on Monday 00:00 and ends on Sunday 23:59:59.999 in Hong Kong", () => {
    const start = hongKongWeekStart(new Date("2026-08-05T10:00:00.000Z"));
    const end = hongKongWeekEnd(start);

    expect(start.toISOString()).toBe("2026-08-02T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-08-09T15:59:59.999Z");
  });

  it("keeps Sunday night in the week that began six days earlier", () => {
    const start = hongKongWeekStart(new Date("2026-08-09T15:59:59.999Z"));

    expect(start.toISOString()).toBe("2026-08-02T16:00:00.000Z");
  });

  it("switches weeks exactly at Monday midnight Hong Kong time", () => {
    const start = hongKongWeekStart(new Date("2026-08-09T16:00:00.000Z"));

    expect(start.toISOString()).toBe("2026-08-09T16:00:00.000Z");
  });
});
