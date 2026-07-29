import { PermissionCode } from "@dse/shared";
import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { RequestContext } from "../common/request-context.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { OriginGuard } from "../auth/origin.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequiresPermission } from "../auth/requires-permission.decorator.js";
import { SessionAuthGuard } from "../auth/session-auth.guard.js";
import { CreateUserDto, SetUserRolesDto, UpdateUserDto, UserStateChangeDto } from "./users.dto.js";
import { UsersService } from "./users.service.js";

@ApiTags("admin-users")
@ApiCookieAuth()
@Controller("admin/users")
@UseGuards(SessionAuthGuard, PermissionGuard)
export class UsersController {
  public constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequiresPermission(PermissionCode.SYSTEM_USERS_READ)
  @ApiQuery({ name: "search", required: false })
  @ApiQuery({ name: "status", required: false, enum: ["ACTIVE", "DISABLED", "LOCKED"] })
  public list(
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query("pageSize", new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
    @Query("search") search?: string,
    @Query("status") status?: "ACTIVE" | "DISABLED" | "LOCKED",
  ) {
    return this.usersService.list({ page, pageSize: Math.min(pageSize, 100), search, status });
  }

  @Post()
  @RequiresPermission(PermissionCode.SYSTEM_USERS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public create(@Body() body: CreateUserDto, @Req() request: RequestContext) {
    return this.usersService.create(body, request);
  }

  @Patch(":id")
  @RequiresPermission(PermissionCode.SYSTEM_USERS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public update(
    @Param("id") id: string,
    @Body() body: UpdateUserDto,
    @Req() request: RequestContext,
  ) {
    return this.usersService.update(id, body, request);
  }

  @Put(":id/roles")
  @RequiresPermission(PermissionCode.SYSTEM_USERS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public setRoles(
    @Param("id") id: string,
    @Body() body: SetUserRolesDto,
    @Req() request: RequestContext,
  ) {
    return this.usersService.setRoles(id, body, request);
  }

  @Post(":id/enable")
  @RequiresPermission(PermissionCode.SYSTEM_USERS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public enable(
    @Param("id") id: string,
    @Body() body: UserStateChangeDto,
    @Req() request: RequestContext,
  ) {
    return this.usersService.enable(id, body, request);
  }

  @Post(":id/disable")
  @RequiresPermission(PermissionCode.SYSTEM_USERS_WRITE)
  @UseGuards(OriginGuard, CsrfGuard)
  public disable(
    @Param("id") id: string,
    @Body() body: UserStateChangeDto,
    @Req() request: RequestContext,
  ) {
    return this.usersService.disable(id, body, request);
  }
}
