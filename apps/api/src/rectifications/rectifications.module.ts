import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import {
  AdminRectificationsController,
  MyRectificationsController,
} from "./rectifications.controller.js";
import { RectificationsService } from "./rectifications.service.js";

@Module({
  imports: [AuthModule],
  controllers: [AdminRectificationsController, MyRectificationsController],
  providers: [RectificationsService],
  exports: [RectificationsService],
})
export class RectificationsModule {}
