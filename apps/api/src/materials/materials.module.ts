import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import { FileStorageService } from "./file-storage.service.js";
import { MaterialAutomationService } from "./material-automation.service.js";
import { MaterialSubmissionsService } from "./material-submissions.service.js";
import { MaterialsController } from "./materials.controller.js";
import { MaterialsService } from "./materials.service.js";

@Module({
  imports: [AuthModule],
  controllers: [MaterialsController],
  providers: [
    MaterialsService,
    MaterialAutomationService,
    MaterialSubmissionsService,
    FileStorageService,
    ServiceProgressService,
  ],
  exports: [
    MaterialsService,
    MaterialAutomationService,
    MaterialSubmissionsService,
    FileStorageService,
  ],
})
export class MaterialsModule {}
