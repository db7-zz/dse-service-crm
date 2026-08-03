import { ErrorCode, PermissionCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient, type Student } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";

@Injectable()
export class StudentAccessService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public scopeFor(actor: AuthenticatedUser): Prisma.StudentWhereInput {
    if (actor.permissions.includes(PermissionCode.STUDENTS_READ)) return {};
    if (actor.roles.includes(RoleCode.BUTLER)) return { defaultButlerId: actor.id };
    if (actor.roles.includes(RoleCode.PLANNER)) return { plannerId: actor.id };
    return { id: "00000000-0000-0000-0000-000000000000" };
  }

  public async assertInternalAccess(
    studentId: string,
    request: RequestContext,
  ): Promise<Pick<Student, "id" | "name" | "defaultButlerId" | "plannerId" | "portalUserId">> {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, ...this.scopeFor(actor) },
      select: {
        id: true,
        name: true,
        defaultButlerId: true,
        plannerId: true,
        portalUserId: true,
      },
    });
    if (student) return student;
    await this.auditDenied(studentId, request, "STUDENT_RELATION_ACCESS_DENIED");
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      ErrorCode.STUDENT_RELATION_FORBIDDEN,
      "无权访问该学生数据",
    );
  }

  public async portalStudent(request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const student = await this.prisma.student.findUnique({
      where: { portalUserId: actor.id },
      select: {
        id: true,
        studentNo: true,
        name: true,
        englishName: true,
        school: true,
        grade: true,
        cohortYear: true,
        nextMilestone: true,
        serviceStatus: true,
      },
    });
    if (!student) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.PORTAL_BINDING_MISSING,
        "学生账号尚未绑定档案，请联系管家",
      );
    }
    return student;
  }

  private async auditDenied(studentId: string, request: RequestContext, action: string) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    await this.prisma.auditLog.create({
      data: {
        operatorId: actor.id,
        operatorRole: actor.roles[0] ?? null,
        objectType: "student",
        objectId: studentId,
        action,
        reason: "当前用户与目标学生不存在有效业务关系",
        requestId: request.requestId,
        ipAddress: request.ip,
        deviceInfo: request.header("User-Agent"),
      },
    });
  }
}
