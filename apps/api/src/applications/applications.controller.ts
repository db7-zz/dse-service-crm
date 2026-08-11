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
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequiresPermission } from "../auth/requires-permission.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import type { RequestContext } from "../common/request-context.js";
import {
  ApplicationDashboardQueryDto,
  AddApplicationActivityDto,
  AddApplicationEvidenceDto,
  ChangeApplicationStatusDto,
  CreateApplicationDto,
  CreateApplicationRequirementDto,
  InvalidateApplicationActivityDto,
  ListApplicationsQueryDto,
  ReturnApplicationEvidenceDto,
  SetApplicationMaterialsDto,
  TransferApplicationOwnerDto,
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

  @Get("dashboard")
  @RequiresPermission(PermissionCode.APPLICATIONS_READ)
  public dashboard(@Query() query: ApplicationDashboardQueryDto, @Req() request: RequestContext) {
    return this.applications.dashboard(query, request);
  }

  @Get("attention")
  @RequiresPermission(PermissionCode.APPLICATIONS_READ)
  public attention(@Query() query: ApplicationDashboardQueryDto, @Req() request: RequestContext) {
    return this.applications.attention(query, request);
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

  @Post(":applicationId/activities")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public addActivity(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: AddApplicationActivityDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.addActivity(applicationId, body, request);
  }

  @Post(":applicationId/activities/:activityId/evidence")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public addEvidence(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Param("activityId", new ParseUUIDPipe({ version: "4" })) activityId: string,
    @Body() body: AddApplicationEvidenceDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.addEvidence(applicationId, activityId, body, request);
  }

  @Get(":applicationId/activities/:activityId/evidence/:evidenceId/download")
  @RequiresPermission(PermissionCode.APPLICATIONS_READ)
  public async downloadEvidence(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Param("activityId", new ParseUUIDPipe({ version: "4" })) activityId: string,
    @Param("evidenceId", new ParseUUIDPipe({ version: "4" })) evidenceId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.applications.downloadEvidence(
      applicationId,
      activityId,
      evidenceId,
      request,
    );
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Post(":applicationId/materials")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public setMaterials(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: SetApplicationMaterialsDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.setMaterials(applicationId, body, request);
  }

  @Post(":applicationId/activities/:activityId/return-evidence")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public returnEvidence(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Param("activityId", new ParseUUIDPipe({ version: "4" })) activityId: string,
    @Body() body: ReturnApplicationEvidenceDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.returnEvidence(applicationId, activityId, body, request);
  }

  @Post(":applicationId/activities/:activityId/invalidate")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public invalidateActivity(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Param("activityId", new ParseUUIDPipe({ version: "4" })) activityId: string,
    @Body() body: InvalidateApplicationActivityDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.invalidateActivity(applicationId, activityId, body, request);
  }

  @Post(":applicationId/transfer-owner")
  @RequiresPermission(PermissionCode.APPLICATIONS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public transferOwner(
    @Param("applicationId", new ParseUUIDPipe({ version: "4" })) applicationId: string,
    @Body() body: TransferApplicationOwnerDto,
    @Req() request: RequestContext,
  ) {
    return this.applications.transferOwner(applicationId, body, request);
  }
}
