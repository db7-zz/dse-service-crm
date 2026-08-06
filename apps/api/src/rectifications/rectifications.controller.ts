import { PermissionCode } from "@dse/shared";
import {
  Body,
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
import {
  CreateRectificationDto,
  ListRectificationsQueryDto,
  ReviewRectificationDto,
  SubmitRectificationDto,
} from "./rectifications.dto.js";
import { RectificationsService } from "./rectifications.service.js";

@ApiTags("admin-rectifications")
@ApiCookieAuth()
@Controller("admin/rectifications")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class AdminRectificationsController {
  public constructor(
    @Inject(RectificationsService) private readonly rectifications: RectificationsService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public list(@Query() query: ListRectificationsQueryDto) {
    return this.rectifications.list(query);
  }

  @Post()
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateRectificationDto, @Req() request: RequestContext) {
    return this.rectifications.create(body, request);
  }

  @Post(":rectificationId/review")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public review(
    @Param("rectificationId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: ReviewRectificationDto,
    @Req() request: RequestContext,
  ) {
    return this.rectifications.review(id, body, request);
  }
}

@ApiTags("my-rectifications")
@ApiCookieAuth()
@Controller("my/rectifications")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MyRectificationsController {
  public constructor(
    @Inject(RectificationsService) private readonly rectifications: RectificationsService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.TASKS_OWN_READ)
  public list(@Query() query: ListRectificationsQueryDto, @Req() request: RequestContext) {
    return this.rectifications.listMine(query, request);
  }

  @Post(":rectificationId/submit")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public submit(
    @Param("rectificationId", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: SubmitRectificationDto,
    @Req() request: RequestContext,
  ) {
    return this.rectifications.submit(id, body, request);
  }
}
