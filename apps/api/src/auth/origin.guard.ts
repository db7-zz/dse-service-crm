import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ErrorCode } from "@dse/shared";
import type { Environment } from "../config/environment.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";

@Injectable()
export class OriginGuard implements CanActivate {
  public constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestContext>();
    const origin = request.header("Origin");
    const environment = this.config.get("NODE_ENV", { infer: true });
    if (!origin && (environment === "development" || environment === "test")) {
      return true;
    }
    if (origin !== this.config.get("APP_ORIGIN", { infer: true })) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.AUTH_CSRF_INVALID, "请求来源校验失败");
    }
    return true;
  }
}
