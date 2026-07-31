import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StudentWorkflowService } from "./student-workflow.service.js";
import { StudentsController } from "./students.controller.js";
import { StudentsService } from "./students.service.js";

@Module({
  imports: [AuthModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentWorkflowService],
})
export class StudentsModule {}
