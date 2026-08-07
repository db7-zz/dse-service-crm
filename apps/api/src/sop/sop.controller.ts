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
  ApplySopMaterialBackfillDto,
  PreviewSopMaterialBackfillDto,
  PublishSopVersionDto,
  UpdateSopVersionDto,
} from "./sop.dto.js";
import { SopService } from "./sop.service.js";

@ApiTags("sop-versions")
@ApiCookieAuth()
@Controller("sop-versions")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class SopController {
  public constructor(@Inject(SopService) private readonly sopService: SopService) {}

  @Get()
  @RequiresPermission(PermissionCode.SOP_READ)
  public list() {
    return this.sopService.list();
  }

  @Post()
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Req() request: RequestContext) {
    return this.sopService.create(request);
  }

  @Get(":versionId")
  @RequiresPermission(PermissionCode.SOP_READ)
  public detail(@Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string) {
    return this.sopService.detail(versionId);
  }

  @Patch(":versionId")
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public update(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Body() body: UpdateSopVersionDto,
    @Req() request: RequestContext,
  ) {
    return this.sopService.update(versionId, body, request);
  }

  @Post(":versionId/validate")
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public validate(@Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string) {
    return this.sopService.validate(versionId);
  }

  @Post(":versionId/publish")
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public publish(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Body() body: PublishSopVersionDto,
    @Req() request: RequestContext,
  ) {
    return this.sopService.publish(versionId, body, request);
  }

  @Post(":versionId/material-backfill/preview")
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public previewMaterialBackfill(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Body() body: PreviewSopMaterialBackfillDto,
  ) {
    return this.sopService.previewMaterialBackfill(versionId, body);
  }

  @Post(":versionId/material-backfill/apply")
  @RequiresPermission(PermissionCode.SOP_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public applyMaterialBackfill(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Body() body: ApplySopMaterialBackfillDto,
    @Req() request: RequestContext,
  ) {
    return this.sopService.applyMaterialBackfill(versionId, body, request);
  }
}
