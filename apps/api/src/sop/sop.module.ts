import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { SopController } from "./sop.controller.js";
import { SopService } from "./sop.service.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [SopController],
  providers: [SopService],
  exports: [SopService],
})
export class SopModule {}
