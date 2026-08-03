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
  ArchiveMaterialDto,
  CreateMaterialItemDto,
  MarkMaterialMissingDto,
  MaterialFollowupDto,
  ReviewMaterialDto,
  UploadMaterialVersionDto,
} from "./materials.dto.js";
import { MaterialsService } from "./materials.service.js";

@ApiTags("materials")
@ApiCookieAuth()
@Controller()
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MaterialsController {
  public constructor(@Inject(MaterialsService) private readonly materials: MaterialsService) {}

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
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.materials.download(versionId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }
}
