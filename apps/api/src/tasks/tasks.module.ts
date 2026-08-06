import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OverdueScannerService } from "./overdue-scanner.service.js";
import { ButlerSupervisionService } from "./butler-supervision.service.js";
import {
  AdminTasksController,
  ButlerSupervisionController,
  MyTasksController,
  OverdueAlertsController,
  TasksController,
  TaskSupervisionController,
} from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import { MaterialsModule } from "../materials/materials.module.js";

@Module({
  imports: [AuthModule, DatabaseModule, MaterialsModule],
  controllers: [
    TasksController,
    MyTasksController,
    ButlerSupervisionController,
    TaskSupervisionController,
    AdminTasksController,
    OverdueAlertsController,
  ],
  providers: [
    TasksService,
    ButlerSupervisionService,
    OverdueScannerService,
    ServiceProgressService,
  ],
  exports: [TasksService, OverdueScannerService],
})
export class TasksModule {}
