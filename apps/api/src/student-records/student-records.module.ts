import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { StudentRecordsController } from "./student-records.controller.js";
import { StudentRecordsService } from "./student-records.service.js";

@Module({
  imports: [AuthModule],
  controllers: [StudentRecordsController],
  providers: [StudentRecordsService],
  exports: [StudentRecordsService],
})
export class StudentRecordsModule {}
