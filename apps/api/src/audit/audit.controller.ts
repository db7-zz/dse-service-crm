import { PermissionCode } from "@dse/shared";
import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequiresPermission } from "../auth/requires-permission.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { AuditService } from "./audit.service.js";

@ApiTags("admin-audit")
@ApiCookieAuth()
@Controller("admin/audit-logs")
@UseGuards(SessionAuthGuard, PermissionGuard)
@RequiresPermission(PermissionCode.SYSTEM_AUDIT_READ)
export class AuditController {
  public constructor(private readonly auditService: AuditService) {}

  @Get()
  public list(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query("action") action?: string,
    @Query("objectType") objectType?: string,
  ) {
    return this.auditService.list({
      page,
      pageSize: Math.min(pageSize, 100),
      action,
      objectType,
    });
  }
}
