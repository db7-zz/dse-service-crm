import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { OriginGuard } from "./origin.guard.js";
import { OptionalSessionAuthGuard } from "./optional-session-auth.guard.js";
import { PermissionGuard } from "./permission.guard.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    CsrfGuard,
    OriginGuard,
    PermissionGuard,
  ],
  exports: [
    AuthService,
    SessionAuthGuard,
    OptionalSessionAuthGuard,
    CsrfGuard,
    OriginGuard,
    PermissionGuard,
  ],
})
export class AuthModule {}
