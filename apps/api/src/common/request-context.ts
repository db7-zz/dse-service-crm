import type { AuthenticatedUser } from "@dse/shared";
import type { Request } from "express";

export interface AuthenticatedSession {
  id: string;
  csrfTokenHash: string;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
}

export interface RequestContext extends Request {
  requestId: string;
  authenticatedUser?: AuthenticatedUser;
  authenticatedSession?: AuthenticatedSession;
  allowMissingCsrf?: boolean;
}
