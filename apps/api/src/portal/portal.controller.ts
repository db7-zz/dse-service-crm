import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
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
  PortalUploadMaterialDto,
  RespondConfirmationDto,
  SubmitPortalProfileDto,
} from "./portal.dto.js";
import { PortalService } from "./portal.service.js";

@ApiTags("student-portal")
@ApiCookieAuth()
@Controller("portal/me")
@UseGuards(SessionAuthGuard, PermissionGuard)
@RequiresPermission(PermissionCode.PORTAL_ACCESS)
export class PortalController {
  public constructor(@Inject(PortalService) private readonly portal: PortalService) {}

  @Get("summary")
  public summary(@Req() request: RequestContext) {
    return this.portal.summary(request);
  }

  @Get("profile")
  public profile(@Req() request: RequestContext) {
    return this.portal.profile(request);
  }

  @Post("profile")
  @UseGuards(OriginGuard, CsrfGuard)
  public submitProfile(@Body() body: SubmitPortalProfileDto, @Req() request: RequestContext) {
    return this.portal.submitProfile(body, request);
  }

  @Get("materials")
  public materials(@Req() request: RequestContext) {
    return this.portal.materialList(request);
  }

  @Post("materials/:materialId/upload")
  @UseGuards(OriginGuard, CsrfGuard)
  public upload(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: PortalUploadMaterialDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.uploadMaterial(materialId, body, request);
  }

  @Get("material-versions/:versionId/download")
  public async download(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.portal.downloadMaterial(versionId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }

  @Get("progress")
  public progress(@Req() request: RequestContext) {
    return this.portal.progress(request);
  }

  @Get("applications")
  public applications(@Req() request: RequestContext) {
    return this.portal.applications(request);
  }

  @Get("confirmations")
  public confirmations(@Req() request: RequestContext) {
    return this.portal.confirmations(request);
  }

  @Post("confirmations/:confirmationId")
  @UseGuards(OriginGuard, CsrfGuard)
  public respondConfirmation(
    @Param("confirmationId", new ParseUUIDPipe({ version: "4" })) confirmationId: string,
    @Body() body: RespondConfirmationDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.respondConfirmation(confirmationId, body, request);
  }
}
