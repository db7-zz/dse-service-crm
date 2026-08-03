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
  ConvertIssueToTaskDto,
  CreateIssueDto,
  IssueActionDto,
  ListIssuesQueryDto,
  RespondIssueDto,
} from "./issues.dto.js";
import { IssuesService } from "./issues.service.js";

@ApiTags("issues")
@ApiCookieAuth()
@Controller("issues")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class IssuesController {
  public constructor(@Inject(IssuesService) private readonly issues: IssuesService) {}

  @Get()
  @RequiresPermission(PermissionCode.ISSUES_READ)
  public list(@Query() query: ListIssuesQueryDto, @Req() request: RequestContext) {
    return this.issues.list(query, request);
  }

  @Get(":issueId")
  @RequiresPermission(PermissionCode.ISSUES_READ)
  public detail(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Req() request: RequestContext,
  ) {
    return this.issues.detail(issueId, request);
  }

  @Post()
  @RequiresPermission(PermissionCode.ISSUES_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateIssueDto, @Req() request: RequestContext) {
    return this.issues.create(body, request);
  }

  @Post(":issueId/information")
  @RequiresPermission(PermissionCode.ISSUES_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public addInformation(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: IssueActionDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.addInformation(issueId, body, request);
  }

  @Post(":issueId/respond")
  @RequiresPermission(PermissionCode.ISSUES_MANAGE)
  @UseGuards(OriginGuard, CsrfGuard)
  public respond(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: RespondIssueDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.respond(issueId, body, request);
  }

  @Post(":issueId/convert-to-task")
  @RequiresPermission(PermissionCode.ISSUES_MANAGE)
  @UseGuards(OriginGuard, CsrfGuard)
  public convertToTask(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: ConvertIssueToTaskDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.convertToTask(issueId, body, request);
  }

  @Post(":issueId/resolve")
  @RequiresPermission(PermissionCode.ISSUES_MANAGE)
  @UseGuards(OriginGuard, CsrfGuard)
  public resolve(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: IssueActionDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.resolve(issueId, body, request);
  }

  @Post(":issueId/close")
  @RequiresPermission(PermissionCode.ISSUES_MANAGE)
  @UseGuards(OriginGuard, CsrfGuard)
  public close(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: IssueActionDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.close(issueId, body, request);
  }

  @Post(":issueId/reopen")
  @RequiresPermission(PermissionCode.ISSUES_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public reopen(
    @Param("issueId", new ParseUUIDPipe({ version: "4" })) issueId: string,
    @Body() body: IssueActionDto,
    @Req() request: RequestContext,
  ) {
    return this.issues.reopen(issueId, body, request);
  }
}
