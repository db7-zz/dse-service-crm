import { ErrorCode, type PermissionCode } from "@dse/shared";
import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PrismaClient } from "@dse/database";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { REQUIRED_PERMISSION } from "./requires-permission.decorator.js";

@Injectable()
export class PermissionGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    if (request.authenticatedUser?.mustChangePassword) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AUTH_PASSWORD_CHANGE_REQUIRED,
        "首次登录必须先修改临时密码",
      );
    }
    const required = this.reflector.getAllAndOverride<PermissionCode>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    if (!request.authenticatedUser?.permissions.includes(required)) {
      await this.prisma.auditLog.create({
        data: {
          operatorId: request.authenticatedUser?.id,
          operatorRole: request.authenticatedUser?.roles[0],
          objectType: "permission",
          objectId: required,
          action: "PERMISSION_DENIED",
          afterData: {
            method: request.method,
            path: request.path,
          },
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      });
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权执行该操作");
    }
    return true;
  }
}
