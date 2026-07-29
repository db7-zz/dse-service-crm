import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@dse/shared";
import type { Environment } from "../config/environment.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { AuthService } from "./auth.service.js";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  public constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const cookieName = this.config.get("SESSION_COOKIE_NAME", { infer: true });
    const token = request.cookies?.[cookieName] as string | undefined;
    if (!token) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, "请先登录");
    }
    const authentication = await this.authService.authenticateSession(token, request);
    request.authenticatedUser = authentication.user;
    request.authenticatedSession = authentication.session;
    return true;
  }
}
