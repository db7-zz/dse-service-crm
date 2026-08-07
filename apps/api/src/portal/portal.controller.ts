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
  CreateMaterialSubmissionDto,
  RemoveMaterialSubmissionFileDto,
  RequestMaterialNotApplicableDto,
  WithdrawMaterialSubmissionDto,
} from "../materials/materials.dto.js";
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
    @Query("preview") preview: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.portal.downloadMaterial(versionId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", this.contentDisposition(file, preview));
    return new StreamableFile(file.buffer);
  }

  @Post("materials/:materialId/submissions")
  @UseGuards(OriginGuard, CsrfGuard)
  public createMaterialSubmission(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: CreateMaterialSubmissionDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.createMaterialSubmission(materialId, body, request);
  }

  @Get("material-submissions/:submissionId")
  public materialSubmissionDetail(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Req() request: RequestContext,
  ) {
    return this.portal.materialSubmissionDetail(submissionId, request);
  }

  @Post("material-submissions/:submissionId/files")
  @UseGuards(OriginGuard, CsrfGuard)
  public addMaterialSubmissionFile(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Body() body: PortalUploadMaterialDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.addMaterialSubmissionFile(submissionId, body, request);
  }

  @Post("material-submissions/:submissionId/files/:fileId/remove")
  @UseGuards(OriginGuard, CsrfGuard)
  public removeMaterialSubmissionFile(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Param("fileId", new ParseUUIDPipe({ version: "4" })) fileId: string,
    @Body() body: RemoveMaterialSubmissionFileDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.removeMaterialSubmissionFile(submissionId, fileId, body, request);
  }

  @Post("material-submissions/:submissionId/submit")
  @UseGuards(OriginGuard, CsrfGuard)
  public submitMaterialSubmission(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Req() request: RequestContext,
  ) {
    return this.portal.submitMaterialSubmission(submissionId, request);
  }

  @Post("material-submissions/:submissionId/withdraw")
  @UseGuards(OriginGuard, CsrfGuard)
  public withdrawMaterialSubmission(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Body() body: WithdrawMaterialSubmissionDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.withdrawMaterialSubmission(submissionId, body, request);
  }

  @Post("materials/:materialId/not-applicable-requests")
  @UseGuards(OriginGuard, CsrfGuard)
  public requestMaterialNotApplicable(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: RequestMaterialNotApplicableDto,
    @Req() request: RequestContext,
  ) {
    return this.portal.requestMaterialNotApplicable(materialId, body, request);
  }

  @Get("material-submission-files/:fileId/download")
  public async downloadMaterialSubmissionFile(
    @Param("fileId", new ParseUUIDPipe({ version: "4" })) fileId: string,
    @Req() request: RequestContext,
    @Query("preview") preview: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.portal.downloadMaterialSubmissionFile(fileId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", this.contentDisposition(file, preview));
    return new StreamableFile(file.buffer);
  }

  private contentDisposition(
    file: { fileName: string; mimeType: string },
    preview: string | undefined,
  ) {
    const inline =
      preview === "true" &&
      (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/"));
    return `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`;
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
