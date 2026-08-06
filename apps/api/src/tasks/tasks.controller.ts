import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  Get,
  Headers,
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
  ButlerSupervisionWeekQueryDto,
  RejectStudentBlockerDto,
  ReportStudentBlockerDto,
  ReviewWeeklyReviewDto,
  SubmitWeeklyReviewDto,
} from "./butler-supervision.dto.js";
import { ButlerSupervisionService } from "./butler-supervision.service.js";
import {
  AddTaskProgressDto,
  AddTaskEvidenceDto,
  CancelTaskDto,
  CompleteTaskDto,
  HandleOverdueAlertDto,
  ListOverdueAlertsQueryDto,
  ListTasksQueryDto,
  MarkTaskNotApplicableDto,
  ReassignTaskDto,
  ReportTaskExtensionDto,
  ReopenTaskDto,
  RescheduleTaskDto,
  TaskVersionDto,
} from "./task.dto.js";
import { TasksService } from "./tasks.service.js";

@ApiTags("tasks")
@ApiCookieAuth()
@Controller("tasks")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class TasksController {
  public constructor(
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(ButlerSupervisionService)
    private readonly butlerSupervision: ButlerSupervisionService,
  ) {}

  @Get(":taskId")
  public detail(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.detail(taskId, request);
  }

  @Get(":taskId/timeline")
  public timeline(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.timeline(taskId, request);
  }

  @Post(":taskId/start")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public start(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: TaskVersionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.start(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/progress")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public progress(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: AddTaskProgressDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.addProgress(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/extensions")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public extension(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: ReportTaskExtensionDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.reportExtension(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/student-blockers")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public reportStudentBlocker(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: ReportStudentBlockerDto,
    @Req() request: RequestContext,
  ) {
    return this.butlerSupervision.reportStudentBlocker(taskId, body, request);
  }

  @Post(":taskId/complete")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public complete(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: CompleteTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.complete(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/not-applicable")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public markNotApplicable(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: MarkTaskNotApplicableDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.markNotApplicable(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/evidence")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public addEvidence(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: AddTaskEvidenceDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.addEvidence(taskId, body, idempotencyKey, request);
  }

  @Get(":taskId/evidence/:evidenceId/download")
  public async downloadEvidence(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Param("evidenceId", new ParseUUIDPipe({ version: "4" })) evidenceId: string,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.tasksService.downloadEvidence(taskId, evidenceId, request);
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer);
  }
}

@ApiTags("my-tasks")
@ApiCookieAuth()
@Controller("my/tasks")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class MyTasksController {
  public constructor(
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(ButlerSupervisionService)
    private readonly butlerSupervision: ButlerSupervisionService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.TASKS_OWN_READ)
  public list(@Query() query: ListTasksQueryDto, @Req() request: RequestContext) {
    return this.tasksService.listMine(query, request);
  }

  @Get("weekly-reviews")
  @RequiresPermission(PermissionCode.TASKS_OWN_READ)
  public weeklyReviews(@Req() request: RequestContext) {
    return this.butlerSupervision.listMine(request);
  }

  @Post("weekly-reviews/:reviewId/submit")
  @RequiresPermission(PermissionCode.TASKS_OWN_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public submitWeeklyReview(
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
    @Body() body: SubmitWeeklyReviewDto,
    @Req() request: RequestContext,
  ) {
    return this.butlerSupervision.submitReview(reviewId, body, request);
  }
}

@ApiTags("butler-supervision")
@ApiCookieAuth()
@Controller("admin/butler-supervision")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class ButlerSupervisionController {
  public constructor(
    @Inject(ButlerSupervisionService)
    private readonly butlerSupervision: ButlerSupervisionService,
  ) {}

  @Get()
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public dashboard(@Query() query: ButlerSupervisionWeekQueryDto) {
    return this.butlerSupervision.dashboard(query);
  }

  @Post("student-blockers/:blockerId/reject")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public rejectBlocker(
    @Param("blockerId", new ParseUUIDPipe({ version: "4" })) blockerId: string,
    @Body() body: RejectStudentBlockerDto,
    @Req() request: RequestContext,
  ) {
    return this.butlerSupervision.rejectStudentBlocker(blockerId, body, request);
  }

  @Post("weekly-reviews/:reviewId/review")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public reviewWeekly(
    @Param("reviewId", new ParseUUIDPipe({ version: "4" })) reviewId: string,
    @Body() body: ReviewWeeklyReviewDto,
    @Req() request: RequestContext,
  ) {
    return this.butlerSupervision.reviewWeekly(reviewId, body, request);
  }
}

@ApiTags("task-supervision")
@ApiCookieAuth()
@Controller("admin/task-supervision")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class TaskSupervisionController {
  public constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @Get("summary")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public summary(@Query() query: ListTasksQueryDto) {
    return this.tasksService.supervisionSummary(query);
  }

  @Get("butlers")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public butlers() {
    return this.tasksService.butlerDashboard();
  }

  @Get("focus")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public focus(@Query() query: ListTasksQueryDto) {
    return this.tasksService.supervisionFocus(query);
  }

  @Get("tasks")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_READ)
  public tasks(@Query() query: ListTasksQueryDto) {
    return this.tasksService.listForSupervision(query);
  }
}

@ApiTags("admin-tasks")
@ApiCookieAuth()
@Controller("admin/tasks")
@UseGuards(SessionAuthGuard, PermissionGuard, OriginGuard, CsrfGuard)
export class AdminTasksController {
  public constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @Post(":taskId/reschedule")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  public reschedule(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: RescheduleTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.reschedule(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/reassign")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  public reassign(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: ReassignTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.reassign(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/cancel")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  public cancel(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: CancelTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.cancel(taskId, body, idempotencyKey, request);
  }

  @Post(":taskId/reopen")
  @RequiresPermission(PermissionCode.TASK_SUPERVISION_WRITE)
  public reopen(
    @Param("taskId", new ParseUUIDPipe({ version: "4" })) taskId: string,
    @Body() body: ReopenTaskDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.reopen(taskId, body, idempotencyKey, request);
  }
}

@ApiTags("overdue-alerts")
@ApiCookieAuth()
@Controller("admin/overdue-alerts")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class OverdueAlertsController {
  public constructor(@Inject(TasksService) private readonly tasksService: TasksService) {}

  @Get()
  @RequiresPermission(PermissionCode.OVERDUE_ALERTS_READ)
  public list(@Query() query: ListOverdueAlertsQueryDto) {
    return this.tasksService.listAlerts(query);
  }

  @Post(":alertId/handle")
  @RequiresPermission(PermissionCode.OVERDUE_ALERTS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public handle(
    @Param("alertId", new ParseUUIDPipe({ version: "4" })) alertId: string,
    @Body() body: HandleOverdueAlertDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Req() request: RequestContext,
  ) {
    return this.tasksService.handleAlert(alertId, body, idempotencyKey, request);
  }
}
