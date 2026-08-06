import {
  AssignableRoleCodes,
  ErrorCode,
  RoleCode,
  type AssignableRoleCode,
  type AuthenticatedUser,
} from "@dse/shared";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@dse/database";
import { ApiException } from "../common/api-exception.js";
import { buildAuditDiff } from "../common/audit-diff.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { hashPassword } from "../auth/password.js";
import type {
  CreateUserDto,
  SetUserRolesDto,
  UpdateUserDto,
  UserStateChangeDto,
} from "./users.dto.js";

const USER_INCLUDE = {
  roles: {
    where: { expiredAt: null },
    include: { role: true },
  },
} as const;

@Injectable()
export class UsersService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(input: {
    page: number;
    pageSize: number;
    search?: string;
    status?: "ACTIVE" | "DISABLED" | "LOCKED";
  }) {
    const where: Prisma.UserWhereInput = {
      roles: {
        none: { expiredAt: null, role: { code: RoleCode.STUDENT } },
      },
      ...(input.status ? { status: input.status } : {}),
      ...(input.search
        ? {
            OR: [
              { username: { contains: input.search, mode: "insensitive" as const } },
              { displayName: { contains: input.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: { createdAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: items.map((user) => this.serializeUser(user)),
      page: input.page,
      pageSize: input.pageSize,
      total,
    };
  }

  public async listStudentAccounts(input: { page: number; pageSize: number; search?: string }) {
    const page = Math.max(1, input.page);
    const pageSize = Math.min(100, Math.max(1, input.pageSize));
    const search = input.search?.trim();
    const where: Prisma.StudentWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { studentNo: { contains: search, mode: "insensitive" } },
            { portalUser: { username: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {};
    const [students, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        include: {
          portalUser: {
            select: {
              id: true,
              username: true,
              status: true,
              mustChangePassword: true,
              lastLoginAt: true,
            },
          },
          defaultButler: { select: { id: true, displayName: true } },
          handoff: { select: { status: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.student.count({ where }),
    ]);
    return {
      items: students.map((student) => ({
        id: student.id,
        studentNo: student.studentNo,
        name: student.name,
        serviceStatus: student.serviceStatus,
        profileStatus: student.profileStatus,
        defaultButler: student.defaultButler,
        account: student.portalUser
          ? {
              id: student.portalUser.id,
              username: student.portalUser.username,
              status: student.portalUser.status,
              mustChangePassword: student.portalUser.mustChangePassword,
              lastLoginAt: student.portalUser.lastLoginAt?.toISOString() ?? null,
            }
          : null,
        accountState: student.portalUser
          ? student.portalUser.status
          : student.handoff?.status === "PENDING_ACCEPTANCE"
            ? "PENDING_BUTLER_ACCEPTANCE"
            : student.serviceStatus === "NOT_ENABLED"
              ? "PENDING_ACTIVATION"
              : "ACTIVATION_FAILED",
        createdAt: student.createdAt.toISOString(),
      })),
      page,
      pageSize,
      total,
    };
  }

  public async create(body: CreateUserDto, request: RequestContext) {
    if (body.roleCodes.includes(RoleCode.STUDENT)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "学生账号必须通过新生建档流程创建",
      );
    }
    const username = body.username.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "登录账号已存在");
    }
    const roles = await this.loadRoles(body.roleCodes);
    const passwordHash = await hashPassword(body.password);
    const result = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.create({
        data: {
          username,
          displayName: body.displayName.trim(),
          passwordHash,
          roles: {
            create: roles.map((role) => ({ roleId: role.id })),
          },
        },
        include: USER_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "USER_CREATED",
          objectId: user.id,
          afterData: {
            username: user.username,
            displayName: user.displayName,
            roleCodes: roles.map((role) => role.code),
          },
        }),
      });
      return user;
    });
    return this.serializeUser(result);
  }

  public async update(id: string, body: UpdateUserDto, request: RequestContext) {
    const existing = await this.findUser(id);
    const passwordHash = body.password ? await hashPassword(body.password) : undefined;
    const updated = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id },
        data: {
          ...(body.displayName ? { displayName: body.displayName.trim() } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
        include: USER_INCLUDE,
      });
      if (passwordHash) {
        await transaction.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "USER_UPDATED",
          objectId: id,
          ...buildAuditDiff(
            { displayName: existing.displayName, passwordChanged: false },
            { displayName: user.displayName, passwordChanged: Boolean(passwordHash) },
          ),
          reason: body.reason,
        }),
      });
      return user;
    });
    return this.serializeUser(updated);
  }

  public async setRoles(id: string, body: SetUserRolesDto, request: RequestContext) {
    if (body.roleCodes.includes(RoleCode.STUDENT)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "学生角色只能由新生建档流程分配",
      );
    }
    const existing = await this.findUser(id);
    const previousRoles = existing.roles.map(({ role }) => role.code);
    if (
      request.authenticatedUser?.id === id &&
      previousRoles.includes(RoleCode.ADMINISTRATOR) &&
      !body.roleCodes.includes(RoleCode.ADMINISTRATOR)
    ) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "不能移除自己的管理员角色");
    }
    const roles = await this.loadRoles(body.roleCodes);
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.userRole.deleteMany({ where: { userId: id } });
      await transaction.userRole.createMany({
        data: roles.map((role) => ({ userId: id, roleId: role.id })),
      });
      await transaction.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "USER_ROLES_CHANGED",
          objectId: id,
          ...buildAuditDiff(
            { roleCodes: previousRoles },
            { roleCodes: roles.map((role) => role.code) },
          ),
          reason: body.reason,
        }),
      });
      return transaction.user.findUniqueOrThrow({ where: { id }, include: USER_INCLUDE });
    });
    return this.serializeUser(result);
  }

  public async disable(id: string, body: UserStateChangeDto, request: RequestContext) {
    if (request.authenticatedUser?.id === id) {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "不能停用自己的账号");
    }
    const existing = await this.findUser(id);
    if (existing.status === "DISABLED") {
      return this.serializeUser(existing);
    }
    const result = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id },
        data: { status: "DISABLED", lockedUntil: null },
        include: USER_INCLUDE,
      });
      await transaction.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "USER_DISABLED",
          objectId: id,
          ...buildAuditDiff({ status: existing.status }, { status: user.status }),
          reason: body.reason,
        }),
      });
      return user;
    });
    return this.serializeUser(result);
  }

  public async enable(id: string, body: UserStateChangeDto, request: RequestContext) {
    const existing = await this.findUser(id);
    const result = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: { id },
        data: {
          status: "ACTIVE",
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
        },
        include: USER_INCLUDE,
      });
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "USER_ENABLED",
          objectId: id,
          ...buildAuditDiff({ status: existing.status }, { status: user.status }),
          reason: body.reason,
        }),
      });
      return user;
    });
    return this.serializeUser(result);
  }

  private async loadRoles(roleCodes: AssignableRoleCode[]) {
    const assignableRoleCodes = new Set<string>(AssignableRoleCodes);
    if (roleCodes.some((roleCode) => !assignableRoleCodes.has(roleCode))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "包含不可分配的历史角色",
      );
    }
    const roles = await this.prisma.role.findMany({ where: { code: { in: roleCodes } } });
    if (roles.length !== new Set(roleCodes).size) {
      throw new ApiException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, "包含无效角色");
    }
    return roles;
  }

  private async findUser(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!user) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "账号不存在");
    }
    return user;
  }

  private serializeUser(user: {
    id: string;
    username: string;
    displayName: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    roles: Array<{ role: { code: string; name: string } }>;
  }) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roles: user.roles.map(({ role }) => ({ code: role.code, name: role.name })),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private auditData(
    request: RequestContext,
    event: {
      action: string;
      objectId: string;
      beforeData?: Prisma.InputJsonObject;
      afterData?: Prisma.InputJsonObject;
      reason?: string;
    },
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType: "user",
      objectId: event.objectId,
      action: event.action,
      beforeData: event.beforeData as Prisma.InputJsonValue | undefined,
      afterData: event.afterData as Prisma.InputJsonValue | undefined,
      reason: event.reason,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
