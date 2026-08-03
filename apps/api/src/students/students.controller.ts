import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
  ActivateStudentServiceDto,
  AssignResponsiblePersonDto,
  BulkAssignUnassignedTasksDto,
  CreateStudentDto,
  CreateManualTaskDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from "./students.dto.js";
import { StudentWorkflowService } from "./student-workflow.service.js";
import { ServiceProgressService } from "./service-progress.service.js";
import { StudentsService } from "./students.service.js";

@ApiTags("students")
@ApiCookieAuth()
@Controller("students")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class StudentsController {
  public constructor(@Inject(StudentsService) private readonly studentsService: StudentsService) {}

  @Inject(StudentWorkflowService)
  private readonly studentWorkflowService!: StudentWorkflowService;

  @Inject(ServiceProgressService)
  private readonly serviceProgressService!: ServiceProgressService;

  @Get("responsible-person-options")
  @RequiresPermission(PermissionCode.STUDENTS_READ)
  public responsiblePersonOptions() {
    return this.studentsService.responsiblePersonOptions();
  }

  @Get()
  @RequiresPermission(PermissionCode.STUDENTS_READ)
  public list(@Query() query: ListStudentsQueryDto) {
    return this.studentsService.list(query);
  }

  @Post()
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateStudentDto, @Req() request: RequestContext) {
    return this.studentsService.create(body, request);
  }

  @Get(":studentId")
  @RequiresPermission(PermissionCode.STUDENTS_READ)
  public detail(@Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string) {
    return this.studentsService.detail(studentId);
  }

  @Get(":studentId/service-progress")
  @RequiresPermission(PermissionCode.STUDENTS_READ)
  public serviceProgress(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
  ) {
    return this.studentsService.serviceProgress(studentId);
  }

  @Post(":studentId/service-progress/recalculate")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public recalculateServiceProgress(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.serviceProgressService.recalculate(studentId, idempotencyKey, request);
  }

  @Post(":studentId/manual-tasks")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public createManualTask(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: CreateManualTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.studentWorkflowService.createManualTask(studentId, body, idempotencyKey, request);
  }

  @Patch(":studentId")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public update(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: UpdateStudentDto,
    @Req() request: RequestContext,
  ) {
    return this.studentsService.update(studentId, body, request);
  }

  @Put(":studentId/default-butler")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public assignDefaultButler(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: AssignResponsiblePersonDto,
    @Req() request: RequestContext,
  ) {
    return this.studentsService.assignResponsiblePerson(studentId, "DEFAULT_BUTLER", body, request);
  }

  @Put(":studentId/planner")
  @RequiresPermission(PermissionCode.STUDENTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public assignPlanner(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: AssignResponsiblePersonDto,
    @Req() request: RequestContext,
  ) {
    return this.studentsService.assignResponsiblePerson(studentId, "PLANNER", body, request);
  }

  @Post(":studentId/service-activation")
  @RequiresPermission(PermissionCode.SERVICE_ACTIVATION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public activateService(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: ActivateStudentServiceDto,
    @Req() request: RequestContext,
  ) {
    return this.studentWorkflowService.activate(studentId, body, request);
  }

  @Post(":studentId/assign-unassigned-tasks")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public bulkAssignUnassignedTasks(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Body() body: BulkAssignUnassignedTasksDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.studentWorkflowService.bulkAssign(studentId, body, idempotencyKey, request);
  }
}

@ApiTags("my-students")
@ApiCookieAuth()
@Controller("my/students")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MyStudentsController {
  public constructor(@Inject(StudentsService) private readonly studentsService: StudentsService) {}

  @Get()
  @RequiresPermission(PermissionCode.STUDENTS_OWN_READ)
  public list(@Query() query: ListStudentsQueryDto, @Req() request: RequestContext) {
    return this.studentsService.listMine(query, request);
  }

  @Get(":studentId")
  @RequiresPermission(PermissionCode.STUDENTS_OWN_READ)
  public detail(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Req() request: RequestContext,
  ) {
    return this.studentsService.detailMine(studentId, request);
  }

  @Get(":studentId/service-progress")
  @RequiresPermission(PermissionCode.STUDENTS_OWN_READ)
  public serviceProgress(
    @Param("studentId", new ParseUUIDPipe({ version: "4" })) studentId: string,
    @Req() request: RequestContext,
  ) {
    return this.studentsService.serviceProgressMine(studentId, request);
  }
}
