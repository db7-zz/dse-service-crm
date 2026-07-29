import type { CookieOptions, Response } from "express";
import { Body, Controller, Get, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import { Throttle } from "@nestjs/throttler";
import type { Environment } from "../config/environment.js";
import type { RequestContext } from "../common/request-context.js";
import { LoginDto } from "./auth.dto.js";
import { AuthService } from "./auth.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { OriginGuard } from "./origin.guard.js";
import { OptionalSessionAuthGuard } from "./optional-session-auth.guard.js";
import { SessionAuthGuard } from "./session-auth.guard.js";

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  public constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  @Post("login")
  @UseGuards(OriginGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: "使用用户名和密码登录" })
  @ApiCreatedResponse({ description: "登录成功并设置会话Cookie" })
  @ApiTooManyRequestsResponse({ description: "登录请求过于频繁" })
  public async login(
    @Body() body: LoginDto,
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(body.username, body.password, request);
    response.cookie(
      this.config.get("SESSION_COOKIE_NAME", { infer: true }),
      result.sessionToken,
      this.sessionCookieOptions(result.absoluteExpiresAt),
    );
    response.cookie(
      this.config.get("CSRF_COOKIE_NAME", { infer: true }),
      result.csrfToken,
      this.csrfCookieOptions(result.absoluteExpiresAt),
    );
    return { user: result.user, expiresAt: result.absoluteExpiresAt.toISOString() };
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  public me(@Req() request: RequestContext) {
    return request.authenticatedUser;
  }

  @Get("csrf")
  @UseGuards(SessionAuthGuard)
  @ApiCookieAuth()
  public async csrf(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = await this.authService.rotateCsrf(request);
    response.cookie(
      this.config.get("CSRF_COOKIE_NAME", { infer: true }),
      token,
      this.csrfCookieOptions(request.authenticatedSession!.absoluteExpiresAt),
    );
    return { csrfToken: token };
  }

  @Post("logout")
  @UseGuards(OptionalSessionAuthGuard, OriginGuard, CsrfGuard)
  @ApiCookieAuth()
  public async logout(
    @Req() request: RequestContext,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.logout(request);
    response.clearCookie(
      this.config.get("SESSION_COOKIE_NAME", { infer: true }),
      this.sessionCookieOptions(),
    );
    response.clearCookie(
      this.config.get("CSRF_COOKIE_NAME", { infer: true }),
      this.csrfCookieOptions(),
    );
    return result;
  }

  private sessionCookieOptions(expires?: Date): CookieOptions {
    const environment = this.config.get("NODE_ENV", { infer: true });
    return {
      httpOnly: true,
      secure: environment === "staging" || environment === "production",
      sameSite: "lax",
      path: "/",
      expires,
    };
  }

  private csrfCookieOptions(expires?: Date): CookieOptions {
    return {
      ...this.sessionCookieOptions(expires),
      httpOnly: false,
    };
  }
}
