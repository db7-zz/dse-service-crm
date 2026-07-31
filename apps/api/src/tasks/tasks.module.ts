import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { OverdueScannerService } from "./overdue-scanner.service.js";
import {
  AdminTasksController,
  MyTasksController,
  OverdueAlertsController,
  TasksController,
  TaskSupervisionController,
} from "./tasks.controller.js";
import { TasksService } from "./tasks.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [
    TasksController,
    MyTasksController,
    TaskSupervisionController,
    AdminTasksController,
    OverdueAlertsController,
  ],
  providers: [TasksService, OverdueScannerService],
  exports: [TasksService, OverdueScannerService],
})
export class TasksModule {}
