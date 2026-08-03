import { Global, Module } from "@nestjs/common";
import { StudentAccessService } from "./student-access.service.js";

@Global()
@Module({
  providers: [StudentAccessService],
  exports: [StudentAccessService],
})
export class AccessModule {}
