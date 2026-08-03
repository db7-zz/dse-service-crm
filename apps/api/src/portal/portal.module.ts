import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { MaterialsModule } from "../materials/materials.module.js";
import { PortalController } from "./portal.controller.js";
import { PortalService } from "./portal.service.js";

@Module({
  imports: [AuthModule, MaterialsModule],
  controllers: [PortalController],
  providers: [PortalService],
})
export class PortalModule {}
