import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@dse/shared";
import type { Environment } from "../config/environment.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { hashToken } from "./security.js";

@Injectable()
export class CsrfGuard implements CanActivate {
  public constructor(private readonly config: ConfigService<Environment, true>) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestContext>();
    if (request.allowMissingCsrf) {
      return true;
    }
    const cookieName = this.config.get("CSRF_COOKIE_NAME", { infer: true });
    const cookieToken = request.cookies?.[cookieName] as string | undefined;
    const headerToken = request.header("X-CSRF-Token");
    const expectedHash = request.authenticatedSession?.csrfTokenHash;
    if (!cookieToken || !headerToken || !expectedHash || cookieToken !== headerToken) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.AUTH_CSRF_INVALID, "安全校验已失效");
    }
    const actual = Buffer.from(hashToken(headerToken));
    const expected = Buffer.from(expectedHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.AUTH_CSRF_INVALID, "安全校验已失效");
    }
    return true;
  }
}
