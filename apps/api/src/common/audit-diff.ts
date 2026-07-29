import type { Prisma } from "@dse/database";

export function buildAuditDiff(
  before: Prisma.InputJsonObject,
  after: Prisma.InputJsonObject,
): {
  beforeData: Prisma.InputJsonObject;
  afterData: Prisma.InputJsonObject;
} {
  const beforeData: { [key: string]: Prisma.InputJsonValue | null | undefined } = {};
  const afterData: { [key: string]: Prisma.InputJsonValue | null | undefined } = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      beforeData[key] = before[key];
      afterData[key] = after[key];
    }
  }
  return { beforeData, afterData };
}
