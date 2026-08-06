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
  AcceptStudentHandoffDto,
  CreateStudentHandoffDto,
  ListStudentHandoffsQueryDto,
} from "./student-handoffs.dto.js";
import { StudentHandoffsService } from "./student-handoffs.service.js";

@ApiTags("student-handoffs")
@ApiCookieAuth()
@Controller("student-handoffs")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class StudentHandoffsController {
  public constructor(
    @Inject(StudentHandoffsService) private readonly handoffs: StudentHandoffsService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.STUDENT_HANDOFFS_READ)
  public list(@Query() query: ListStudentHandoffsQueryDto, @Req() request: RequestContext) {
    return this.handoffs.list(query, request);
  }

  @Post()
  @RequiresPermission(PermissionCode.STUDENT_HANDOFFS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateStudentHandoffDto, @Req() request: RequestContext) {
    return this.handoffs.create(body, request);
  }

  @Post(":handoffId/accept")
  @RequiresPermission(PermissionCode.STUDENTS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public accept(
    @Param("handoffId", new ParseUUIDPipe({ version: "4" })) handoffId: string,
    @Body() body: AcceptStudentHandoffDto,
    @Req() request: RequestContext,
  ) {
    return this.handoffs.accept(handoffId, body, request);
  }
}
