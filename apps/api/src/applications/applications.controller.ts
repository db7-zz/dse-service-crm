import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
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
  ChangeApplicationStatusDto,
  CreateApplicationDto,
  CreateApplicationRequirementDto,
  ListApplicationsQueryDto,
  UpdateApplicationDto,
} from "./applications.dto.js";
import { ApplicationsService } from "./applications.service.js";

@ApiTags("applications")
@ApiCookieAuth()
@Controller("applications")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ApplicationsController {
  public constructor(
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.APPLICATIONS_READ)
  public list(@Query() query: ListApplicationsQueryDto, @Req() request: RequestContext) {
    return this.applications.list(query, request);
  }

  @Get(":applicationId")
  @RequiresPermission(PermissionCode.APPLICATIONS_READ)
  public detail(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Req() request: RequestContext,
  ) {
    return this.applications.detail(applicationId, request);
  }

  @Post()
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateApplicationDto, @Req() request: RequestContext) {
    return this.applications.create(body, request);
  }

  @Patch(":applicationId")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public update(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: UpdateApplicationDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.update(applicationId, body, request);
  }

  @Post(":applicationId/change-status")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public changeStatus(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: ChangeApplicationStatusDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.changeStatus(applicationId, body, request);
  }

  @Post(":applicationId/requirements")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public createRequirement(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: CreateApplicationRequirementDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.createRequirement(applicationId, body, request);
  }
}
