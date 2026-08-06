import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StudentWorkflowService } from "./student-workflow.service.js";
import { MyStudentsController, StudentsController } from "./students.controller.js";
import { StudentsService } from "./students.service.js";
import { ServiceProgressService } from "./service-progress.service.js";
import { StudentHandoffsController } from "./student-handoffs.controller.js";
import { StudentHandoffsService } from "./student-handoffs.service.js";

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, MyStudentsController, StudentHandoffsController],
  providers: [
    StudentsService,
    StudentWorkflowService,
    ServiceProgressService,
    StudentHandoffsService,
  ],
})
export class StudentsModule {}
