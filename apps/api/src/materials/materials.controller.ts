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
  ArchiveMaterialDto,
  CancelSpecialMaterialDto,
  CreateMaterialSubmissionDto,
  CreateMaterialItemDto,
  MarkMaterialMissingDto,
  MaterialFollowupDto,
  RemoveMaterialSubmissionFileDto,
  ReviewMaterialDto,
  ReviewMaterialApplicabilityDto,
  ReviewMaterialSubmissionDto,
  UploadMaterialVersionDto,
  WithdrawMaterialSubmissionDto,
} from "./materials.dto.js";
import { MaterialAutomationService } from "./material-automation.service.js";
import { MaterialSubmissionsService } from "./material-submissions.service.js";
import { MaterialsService } from "./materials.service.js";

@ApiTags("materials")
@ApiCookieAuth()
@Controller()
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MaterialsController {
  public constructor(
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(MaterialAutomationService) private readonly automation: MaterialAutomationService,
    @Inject(MaterialSubmissionsService) private readonly submissions: MaterialSubmissionsService,
  ) {}

  @Get("material-automation/status")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  public automationStatus() {
    return this.automation.status();
  }

  @Post("material-automation/scan")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public runAutomationScan() {
    return this.automation.scan();
  }

  @Get("material-types")
  @RequiresPermission(PermissionCode.MATERIALS_READ)
  public types() {
    return this.materials.types();
  }

  @Get("students/:studentId/materials")
  @RequiresPermission(PermissionCode.MATERIALS_READ)
  public list(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Req() request: RequestContext,
  ) {
    return this.materials.list(studentId, request);
  }

  @Post("students/:studentId/materials")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: CreateMaterialItemDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.create(studentId, body, request);
  }

  @Post("materials/:materialId/versions")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public upload(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: UploadMaterialVersionDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.upload(materialId, body, request);
  }

  @Post("materials/:materialId/review")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public review(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: ReviewMaterialDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.review(materialId, body, request);
  }

  @Post("materials/:materialId/mark-missing")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public markMissing(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: MarkMaterialMissingDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.markMissing(materialId, body, request);
  }

  @Post("materials/:materialId/followups")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public followup(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: MaterialFollowupDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.followup(materialId, body, request);
  }

  @Post("materials/:materialId/archive")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public archive(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: ArchiveMaterialDto,
    @Req() request: RequestContext,
  ) {
    return this.materials.archive(materialId, body, request);
  }

  @Get("materials/versions/:versionId/download")
  @RequiresPermission(PermissionCode.MATERIALS_READ)
  public async download(
    @Param("versionId", new ParseUUIDPipe({ version: "4" })) versionId: string,
    @Req() request: RequestContext,
    @Query("preview") preview: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.materials.download(versionId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Disposition", this.contentDisposition(file, preview));
    return new StreamableFile(file.buffer);
  }

  @Get("material-submissions/:submissionId")
  @RequiresPermission(PermissionCode.MATERIALS_READ)
  public submissionDetail(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Req() request: RequestContext,
  ) {
    return this.submissions.detail(submissionId, request);
  }

  @Post("materials/:materialId/submissions")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public createSubmission(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: CreateMaterialSubmissionDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.createDraft(materialId, body, request);
  }

  @Post("material-submissions/:submissionId/files")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public addSubmissionFile(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Body() body: UploadMaterialVersionDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.addFile(submissionId, body, request);
  }

  @Post("material-submissions/:submissionId/files/:fileId/remove")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public removeSubmissionFile(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Param("fileId", new ParseUUIDPipe({ version: "4" })) fileId: string,
    @Body() body: RemoveMaterialSubmissionFileDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.removeFile(submissionId, fileId, body, request);
  }

  @Post("material-submissions/:submissionId/submit")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public submitSubmission(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Req() request: RequestContext,
  ) {
    return this.submissions.submit(submissionId, request);
  }

  @Post("material-submissions/:submissionId/withdraw")
  @RequiresPermission(PermissionCode.MATERIALS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public withdrawSubmission(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Body() body: WithdrawMaterialSubmissionDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.withdraw(submissionId, body, request);
  }

  @Post("material-submissions/:submissionId/review/start")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public startSubmissionReview(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Req() request: RequestContext,
  ) {
    return this.submissions.startReview(submissionId, request);
  }

  @Post("material-submissions/:submissionId/review")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public reviewSubmission(
    @Param("submissionId", new ParseUUIDPipe({ version: "4" })) submissionId: string,
    @Body() body: ReviewMaterialSubmissionDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.review(submissionId, body, request);
  }

  @Post("material-applicability-requests/:requestId/review")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public reviewApplicability(
    @Param("requestId", new ParseUUIDPipe({ version: "4" })) requestId: string,
    @Body() body: ReviewMaterialApplicabilityDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.reviewApplicability(requestId, body, request);
  }

  @Post("materials/:materialId/cancel")
  @RequiresPermission(PermissionCode.MATERIALS_REVIEW)
  @UseGuards(OriginGuard, CsrfGuard)
  public cancelSpecial(
    @Param("materialId", new ParseUUIDPipe({ version: "4" })) materialId: string,
    @Body() body: CancelSpecialMaterialDto,
    @Req() request: RequestContext,
  ) {
    return this.submissions.cancelSpecial(materialId, body, request);
  }

  @Get("material-submission-files/:fileId/download")
  @RequiresPermission(PermissionCode.MATERIALS_READ)
  public async downloadSubmissionFile(
    @Param("fileId", new ParseUUIDPipe({ version: "4" })) fileId: string,
    @Req() request: RequestContext,
    @Query("preview") preview: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.submissions.downloadFile(fileId, request);
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
}
