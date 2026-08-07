import type { PrismaClient } from "@dse/database";
import { describe, expect, it, vi } from "vitest";
import { MaterialAutomationService } from "./material-automation.service.js";

const now = new Date("2026-08-07T04:00:00.000Z");

type CreatedNotification = {
  recipientId: string;
  eventType: string;
  eventKey: string;
};

type CreateManyInput = {
  data: CreatedNotification[];
  skipDuplicates?: boolean;
};

describe("material automation notifications", () => {
  it("routes deadline, overdue and review SLA notifications to the responsible roles", async () => {
    const createMany = vi.fn(async ({ data }: CreateManyInput) => ({ count: data.length }));
    const prisma = {
      materialItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "material-upcoming",
            title: "成绩单",
            status: "REQUIRED",
            dueAt: new Date("2026-08-10T04:00:00.000Z"),
            correctionDueAt: null,
            expectedSubmitAt: null,
            ownerId: "owner-a",
            studentId: "student-a",
            student: {
              name: "陈同学",
              portalUserId: "portal-a",
              defaultButlerId: "butler-a",
            },
          },
          {
            id: "material-overdue",
            title: "身份证明",
            status: "NEEDS_CORRECTION",
            dueAt: new Date("2026-08-20T04:00:00.000Z"),
            correctionDueAt: new Date("2026-08-04T04:00:00.000Z"),
            expectedSubmitAt: new Date("2026-08-05T04:00:00.000Z"),
            ownerId: "owner-b",
            studentId: "student-b",
            student: {
              name: "李同学",
              portalUserId: "portal-b",
              defaultButlerId: "butler-b",
            },
          },
        ]),
      },
      materialSubmission: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "submission-a",
            submissionNo: 2,
            source: "STUDENT",
            submittedAt: new Date("2026-08-04T04:00:00.000Z"),
            reviewStartedById: null,
            materialItem: {
              id: "material-review",
              studentId: "student-c",
              title: "推荐信素材",
              ownerId: "owner-c",
              student: { name: "王同学", defaultButlerId: "butler-c" },
            },
          },
        ]),
      },
      user: { findMany: vi.fn().mockResolvedValue([{ id: "admin-a" }]) },
      notification: { createMany },
    };
    const service = new MaterialAutomationService(prisma as unknown as PrismaClient);

    vi.useFakeTimers();
    vi.setSystemTime(now);
    const result = await service.scan();
    vi.useRealTimers();

    expect(result).toEqual({
      dueSoonNotified: 2,
      overdueNotified: 3,
      reviewSlaNotified: 2,
      failed: 0,
    });
    const notifications = createMany.mock.calls.flatMap(([input]) => input.data);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipientId: "portal-a", eventType: "MATERIAL_DUE_SOON" }),
        expect.objectContaining({ recipientId: "butler-b", eventType: "MATERIAL_OVERDUE" }),
        expect.objectContaining({ recipientId: "admin-a", eventType: "MATERIAL_OVERDUE" }),
        expect.objectContaining({
          recipientId: "butler-c",
          eventType: "MATERIAL_REVIEW_OVERDUE",
        }),
      ]),
    );
    expect(new Set(notifications.map(({ eventKey }) => eventKey)).size).toBe(notifications.length);
    expect(createMany.mock.calls.every(([input]) => input.skipDuplicates === true)).toBe(true);
  });

  it("sends a butler proxy submission directly to administrators", async () => {
    const createMany = vi.fn(async ({ data }: CreateManyInput) => ({ count: data.length }));
    const prisma = {
      materialItem: { findMany: vi.fn().mockResolvedValue([]) },
      materialSubmission: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "submission-proxy",
            submissionNo: 1,
            source: "BUTLER",
            submittedAt: new Date("2026-08-06T04:00:00.000Z"),
            reviewStartedById: null,
            materialItem: {
              id: "material-proxy",
              studentId: "student-a",
              title: "特殊说明",
              ownerId: "butler-a",
              student: { name: "陈同学", defaultButlerId: "butler-a" },
            },
          },
        ]),
      },
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "admin-a" }, { id: "admin-b" }]),
      },
      notification: { createMany },
    };
    const service = new MaterialAutomationService(prisma as unknown as PrismaClient);

    vi.useFakeTimers();
    vi.setSystemTime(now);
    const result = await service.scan();
    vi.useRealTimers();

    expect(result.reviewSlaNotified).toBe(2);
    const recipients = createMany.mock.calls.flatMap(([input]) =>
      input.data.map((notification) => notification.recipientId),
    );
    expect(recipients).toEqual(["admin-a", "admin-b"]);
  });
});
