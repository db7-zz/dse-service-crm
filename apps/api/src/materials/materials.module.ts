import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import { FileStorageService } from "./file-storage.service.js";
import { MaterialsController } from "./materials.controller.js";
import { MaterialsService } from "./materials.service.js";

@Module({
  imports: [AuthModule],
  controllers: [MaterialsController],
  providers: [MaterialsService, FileStorageService, ServiceProgressService],
  exports: [MaterialsService, FileStorageService],
})
export class MaterialsModule {}
