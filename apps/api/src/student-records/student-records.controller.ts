import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
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
  UpdateStudentRecordDto,
  UpdateStudentRiskDto,
  UpdateStudentServiceStatusDto,
} from "./student-records.dto.js";
import { StudentRecordsService } from "./student-records.service.js";

@ApiTags("student-records")
@ApiCookieAuth()
@Controller("students")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class StudentRecordsController {
  public constructor(
    @Inject(StudentRecordsService) private readonly records: StudentRecordsService,
  ) {}

  @Get(":studentId/record")
  public detail(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Req() request: RequestContext,
  ) {
    return this.records.detail(studentId, request);
  }

  @Put(":studentId/record")
  @RequiresPermission(PermissionCode.STUDENTS_PLANNING_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public update(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: UpdateStudentRecordDto,
    @Req() request: RequestContext,
  ) {
    return this.records.update(studentId, body, request);
  }

  @Patch(":studentId/risk")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public updateRisk(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: UpdateStudentRiskDto,
    @Req() request: RequestContext,
  ) {
    return this.records.updateRisk(studentId, body, request);
  }

  @Patch(":studentId/service-status")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public updateServiceStatus(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: UpdateStudentServiceStatusDto,
    @Req() request: RequestContext,
  ) {
    return this.records.updateServiceStatus(studentId, body, request);
  }
}
