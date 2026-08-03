import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StudentWorkflowService } from "./student-workflow.service.js";
import { MyStudentsController, StudentsController } from "./students.controller.js";
import { StudentsService } from "./students.service.js";
import { ServiceProgressService } from "./service-progress.service.js";

@Module({
  imports: [AuthModule],
  controllers: [StudentsController, MyStudentsController],
  providers: [StudentsService, StudentWorkflowService, ServiceProgressService],
})
export class StudentsModule {}
