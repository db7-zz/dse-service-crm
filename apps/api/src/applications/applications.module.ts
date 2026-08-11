import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MaterialsModule } from "../materials/materials.module.js";
import { ApplicationsController } from "./applications.controller.js";
import { ApplicationsService } from "./applications.service.js";

@Module({
  imports: [AuthModule, MaterialsModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
