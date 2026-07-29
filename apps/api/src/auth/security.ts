import { createHash, randomBytes } from "node:crypto";

export interface LoginFailureState {
  failedLoginCount: number;
  failedLoginWindowStartedAt: Date;
  lockedUntil: Date | null;
  shouldLock: boolean;
}

export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSessionExpired(now: Date, absoluteExpiresAt: Date, idleExpiresAt: Date): boolean {
  return absoluteExpiresAt <= now || idleExpiresAt <= now;
}

export function calculateLoginFailure(
  now: Date,
  previousCount: number,
  previousWindowStartedAt: Date | null,
  windowSeconds: number,
  maximumFailures: number,
  lockSeconds: number,
): LoginFailureState {
  const windowActive =
    previousWindowStartedAt !== null &&
    now.getTime() - previousWindowStartedAt.getTime() <= windowSeconds * 1000;
  const failedLoginCount = windowActive ? previousCount + 1 : 1;
  const shouldLock = failedLoginCount >= maximumFailures;
  return {
    failedLoginCount,
    failedLoginWindowStartedAt:
      windowActive && previousWindowStartedAt ? previousWindowStartedAt : now,
    lockedUntil: shouldLock ? new Date(now.getTime() + lockSeconds * 1000) : null,
    shouldLock,
  };
}
