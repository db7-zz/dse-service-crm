import { Inject, Injectable, HttpStatus } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ErrorCode,
  RoleCode,
  type AuthenticatedUser,
  type PermissionCode,
  type RoleCode as RoleCodeType,
} from "@dse/shared";
import type { Prisma, PrismaClient } from "@dse/database";
import type { Environment } from "../config/environment.js";
import { PRISMA } from "../database/database.module.js";
import { ApiException } from "../common/api-exception.js";
import type { AuthenticatedSession, RequestContext } from "../common/request-context.js";
import {
  calculateLoginFailure,
  generateOpaqueToken,
  hashToken,
  isSessionExpired,
} from "./security.js";
import { hashPassword, verifyPassword } from "./password.js";

interface LoginResult {
  user: AuthenticatedUser;
  sessionToken: string;
  csrfToken: string;
  absoluteExpiresAt: Date;
}

interface SessionResult {
  user: AuthenticatedUser;
  session: AuthenticatedSession;
}

const USER_RELATIONS = {
  roles: {
    where: { expiredAt: null },
    include: {
      role: {
        include: {
          permissions: {
            include: { permission: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class AuthService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  public async login(
    usernameInput: string,
    password: string,
    request: RequestContext,
  ): Promise<LoginResult> {
    const username = usernameInput.trim().toLowerCase();
    const now = new Date();
    let user = await this.prisma.user.findUnique({
      where: { username },
      include: USER_RELATIONS,
    });
    const isStudentAccount = Boolean(
      user?.roles.some(({ role }) => role.code === RoleCode.STUDENT),
    );

    if (!user) {
      await hashPassword(password);
      await this.writeAudit({
        action: "LOGIN_FAILED",
        objectType: "user",
        objectId: null,
        afterData: { username, reason: "invalid_credentials" },
        request,
      });
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "账号或密码错误",
      );
    }

    if (user.status === "DISABLED") {
      await this.writeAudit({
        action: "LOGIN_FAILED",
        objectType: "user",
        objectId: user.id,
        afterData: { reason: "disabled" },
        request,
      });
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AUTH_ACCOUNT_DISABLED,
        "账号已停用，请联系管理员",
      );
    }

    if (!isStudentAccount && user.lockedUntil && user.lockedUntil > now) {
      await this.writeAudit({
        action: "LOGIN_FAILED",
        objectType: "user",
        objectId: user.id,
        afterData: { reason: "locked", lockedUntil: user.lockedUntil.toISOString() },
        request,
      });
      throw new ApiException(
        HttpStatus.LOCKED,
        ErrorCode.AUTH_ACCOUNT_LOCKED,
        "账号暂时锁定，请稍后重试",
        { lockedUntil: user.lockedUntil.toISOString() },
      );
    }

    if (user.status === "LOCKED") {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          status: "ACTIVE",
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
        },
        include: USER_RELATIONS,
      });
    }

    const passwordValid = await verifyPassword(user.passwordHash, password);
    if (!passwordValid) {
      if (isStudentAccount) {
        await this.writeAudit({
          action: "LOGIN_FAILED",
          objectType: "user",
          objectId: user.id,
          afterData: { reason: "invalid_credentials" },
          request,
        });
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          ErrorCode.AUTH_INVALID_CREDENTIALS,
          "账号或密码错误",
        );
      }
      const failure = calculateLoginFailure(
        now,
        user.failedLoginCount,
        user.failedLoginWindowStartedAt,
        this.config.get("LOGIN_FAILURE_WINDOW_SECONDS", { infer: true }),
        this.config.get("LOGIN_MAX_FAILURES", { infer: true }),
        this.config.get("LOGIN_LOCK_SECONDS", { infer: true }),
      );
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginCount: failure.failedLoginCount,
            failedLoginWindowStartedAt: failure.failedLoginWindowStartedAt,
            lockedUntil: failure.lockedUntil,
            status: failure.shouldLock ? "LOCKED" : "ACTIVE",
          },
        }),
        this.prisma.auditLog.create({
          data: {
            action: failure.shouldLock ? "ACCOUNT_LOCKED" : "LOGIN_FAILED",
            objectType: "user",
            objectId: user.id,
            afterData: {
              reason: "invalid_credentials",
              failureCount: failure.failedLoginCount,
            },
            requestId: request.requestId,
            ipAddress: request.ip,
            deviceInfo: request.header("User-Agent"),
          },
        }),
      ]);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "账号或密码错误",
      );
    }

    if (
      user.mustChangePassword &&
      user.temporaryPasswordExpiresAt &&
      user.temporaryPasswordExpiresAt <= now
    ) {
      await this.writeAudit({
        action: "LOGIN_FAILED",
        objectType: "user",
        objectId: user.id,
        afterData: { reason: "temporary_password_expired" },
        request,
      });
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AUTH_TEMPORARY_PASSWORD_EXPIRED,
        "临时密码已过期，请联系管理员处理",
      );
    }

    const sessionToken = generateOpaqueToken();
    const csrfToken = generateOpaqueToken();
    const absoluteExpiresAt = new Date(
      now.getTime() + this.config.get("SESSION_ABSOLUTE_TTL_SECONDS", { infer: true }) * 1000,
    );
    const idleExpiresAt = new Date(
      now.getTime() + this.config.get("SESSION_IDLE_TTL_SECONDS", { infer: true }) * 1000,
    );
    const authenticatedUser = this.toAuthenticatedUser(user);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
          status: "ACTIVE",
          lastLoginAt: now,
        },
      }),
      this.prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(sessionToken),
          csrfTokenHash: hashToken(csrfToken),
          absoluteExpiresAt,
          idleExpiresAt,
          ipAddress: request.ip,
          userAgent: request.header("User-Agent"),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          operatorId: user.id,
          operatorRole: authenticatedUser.roles[0] ?? null,
          action: "LOGIN_SUCCESS",
          objectType: "user",
          objectId: user.id,
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      }),
    ]);

    return { user: authenticatedUser, sessionToken, csrfToken, absoluteExpiresAt };
  }

  public async authenticateSession(token: string, request: RequestContext): Promise<SessionResult> {
    const now = new Date();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: USER_RELATIONS } },
    });
    if (!session || session.revokedAt) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.UNAUTHENTICATED,
        "登录状态无效，请重新登录",
      );
    }
    if (isSessionExpired(now, session.absoluteExpiresAt, session.idleExpiresAt)) {
      await this.prisma.$transaction([
        this.prisma.session.update({
          where: { id: session.id },
          data: { revokedAt: now },
        }),
        this.prisma.auditLog.create({
          data: {
            operatorId: session.userId,
            action: "SESSION_EXPIRED",
            objectType: "session",
            objectId: session.id,
            requestId: request.requestId,
            ipAddress: request.ip,
            deviceInfo: request.header("User-Agent"),
          },
        }),
      ]);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        ErrorCode.AUTH_SESSION_EXPIRED,
        "登录已过期，请重新登录",
      );
    }
    if (session.user.status !== "ACTIVE") {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.AUTH_ACCOUNT_DISABLED,
        "账号当前不可用",
      );
    }

    if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      const proposedIdle = new Date(
        now.getTime() + this.config.get("SESSION_IDLE_TTL_SECONDS", { infer: true }) * 1000,
      );
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastSeenAt: now,
          idleExpiresAt:
            proposedIdle < session.absoluteExpiresAt ? proposedIdle : session.absoluteExpiresAt,
        },
      });
    }

    return {
      user: this.toAuthenticatedUser(session.user),
      session: {
        id: session.id,
        csrfTokenHash: session.csrfTokenHash,
        absoluteExpiresAt: session.absoluteExpiresAt,
        idleExpiresAt: session.idleExpiresAt,
      },
    };
  }

  public async logout(request: RequestContext): Promise<{ loggedOut: true }> {
    const sessionId = request.authenticatedSession?.id;
    if (!sessionId) {
      return { loggedOut: true };
    }
    await this.prisma.$transaction([
      this.prisma.session.update({
        where: { id: sessionId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          operatorId: request.authenticatedUser?.id,
          operatorRole: request.authenticatedUser?.roles[0],
          action: "LOGOUT",
          objectType: "session",
          objectId: sessionId,
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      }),
    ]);
    return { loggedOut: true };
  }

  public async changePassword(
    currentPassword: string,
    newPassword: string,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (currentPassword === newPassword) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "新密码不能与当前密码相同",
      );
    }
    const user = await this.prisma.user.findUnique({ where: { id: actor.id } });
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.AUTH_INVALID_CREDENTIALS,
        "当前密码不正确",
      );
    }
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: actor.id },
        data: {
          passwordHash,
          mustChangePassword: false,
          temporaryPasswordExpiresAt: null,
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
        },
      }),
      this.prisma.session.updateMany({
        where: {
          userId: actor.id,
          id: { not: request.authenticatedSession!.id },
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          operatorId: actor.id,
          operatorRole: actor.roles[0] ?? null,
          action: "PASSWORD_CHANGED",
          objectType: "user",
          objectId: actor.id,
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      }),
    ]);
    actor.mustChangePassword = false;
    return { changed: true as const };
  }

  public async rotateCsrf(request: RequestContext): Promise<string> {
    const token = generateOpaqueToken();
    await this.prisma.session.update({
      where: { id: request.authenticatedSession!.id },
      data: { csrfTokenHash: hashToken(token) },
    });
    request.authenticatedSession!.csrfTokenHash = hashToken(token);
    return token;
  }

  private toAuthenticatedUser(user: {
    id: string;
    username: string;
    displayName: string;
    mustChangePassword: boolean;
    roles: Array<{
      role: {
        code: string;
        permissions: Array<{ permission: { code: string } }>;
      };
    }>;
  }): AuthenticatedUser {
    const roles = user.roles.map(({ role }) => role.code as RoleCodeType);
    const permissions = [
      ...new Set(
        user.roles.flatMap(({ role }) =>
          role.permissions.map(({ permission }) => permission.code as PermissionCode),
        ),
      ),
    ];
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      permissions,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async writeAudit(input: {
    action: string;
    objectType: string;
    objectId: string | null;
    afterData?: Prisma.InputJsonObject;
    request: RequestContext;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: input.action,
        objectType: input.objectType,
        objectId: input.objectId,
        afterData: input.afterData as Prisma.InputJsonValue | undefined,
        requestId: input.request.requestId,
        ipAddress: input.request.ip,
        deviceInfo: input.request.header("User-Agent"),
      },
    });
  }
}
