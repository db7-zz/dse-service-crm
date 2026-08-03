import { PermissionCode } from "@dse/shared";
import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequiresPermission } from "../auth/requires-permission.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { RequestContext } from "../common/request-context.js";
import { ListNotificationsQueryDto } from "./notifications.dto.js";
import { NotificationsService } from "./notifications.service.js";

@ApiTags("notifications")
@ApiCookieAuth()
@Controller("notifications")
@UseGuards(SessionAuthGuard, PermissionGuard)
@RequiresPermission(PermissionCode.NOTIFICATIONS_READ)
export class NotificationsController {
  public constructor(
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  @Get()
  public list(@Query() query: ListNotificationsQueryDto, @Req() request: RequestContext) {
    return this.notifications.list(query, request);
  }

  @Post(":notificationId/read")
  @UseGuards(OriginGuard, CsrfGuard)
  public markRead(
    @Param("notificationId", new ParseUUIDPipe({ version: "4" })) notificationId: string,
    @Req() request: RequestContext,
  ) {
    return this.notifications.markRead(notificationId, request);
  }

  @Post("read-all")
  @UseGuards(OriginGuard, CsrfGuard)
  public markAllRead(@Req() request: RequestContext) {
    return this.notifications.markAllRead(request);
  }
}
