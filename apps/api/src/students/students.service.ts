import {
  ErrorCode,
  RoleCode,
  type AuthenticatedUser,
  type RoleCode as RoleCodeType,
} from "@dse/shared";
import { Prisma, type PrismaClient, type StudentResponsibilityType } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import { buildAuditDiff } from "../common/audit-diff.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import type {
  AssignResponsiblePersonDto,
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from "./students.dto.js";

const STUDENT_INCLUDE = {
  defaultButler: { select: { id: true, displayName: true } },
  planner: { select: { id: true, displayName: true } },
  createdBy: { select: { id: true, displayName: true } },
} as const;

const STUDENT_DETAIL_INCLUDE = {
  ...STUDENT_INCLUDE,
  responsibilityChanges: {
    include: {
      previousUser: { select: { id: true, displayName: true } },
      newUser: { select: { id: true, displayName: true } },
      operator: { select: { id: true, displayName: true } },
    },
    orderBy: { createdAt: "desc" as const },
  },
} as const;

type StudentWithPeople = Prisma.StudentGetPayload<{ include: typeof STUDENT_INCLUDE }>;
type StudentWithHistory = Prisma.StudentGetPayload<{ include: typeof STUDENT_DETAIL_INCLUDE }>;

@Injectable()
export class StudentsService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(input: ListStudentsQueryDto) {
    const requestedPage = Number(input.page);
    const pageSize = Number(input.pageSize);
    const search = input.search?.trim();
    const where: Prisma.StudentWhereInput = {
      ...(input.serviceStatus ? { serviceStatus: input.serviceStatus } : {}),
      ...(input.defaultButlerId ? { defaultButlerId: input.defaultButlerId } : {}),
      ...(input.plannerId ? { plannerId: input.plannerId } : {}),
      ...(search
        ? {
            OR: [
              { studentNo: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const total = await this.prisma.student.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, lastPage);
    const items = await this.prisma.student.findMany({
      where,
      include: STUDENT_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((student) => this.serializeStudent(student)),
      page,
      pageSize,
      total,
    };
  }

  public async responsiblePersonOptions() {
    const people = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        roles: {
          some: {
            expiredAt: null,
            role: { code: { in: [RoleCode.BUTLER, RoleCode.PLANNER] } },
          },
        },
      },
      select: {
        id: true,
        displayName: true,
        roles: {
          where: {
            expiredAt: null,
            role: { code: { in: [RoleCode.BUTLER, RoleCode.PLANNER] } },
          },
          select: { role: { select: { code: true } } },
        },
      },
      orderBy: { displayName: "asc" },
    });
    const options = people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      roleCodes: person.roles.map(({ role }) => role.code),
    }));
    return {
      butlers: options.filter((person) => person.roleCodes.includes(RoleCode.BUTLER)),
      planners: options.filter((person) => person.roleCodes.includes(RoleCode.PLANNER)),
    };
  }

  public async create(body: CreateStudentDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const name = body.name.trim();
    if (!name) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "学生姓名不能为空",
      );
    }

    try {
      const student = await this.prisma.$transaction(async (transaction) => {
        if (body.defaultButlerId) {
          await this.loadResponsiblePerson(transaction, body.defaultButlerId, RoleCode.BUTLER);
        }
        if (body.plannerId) {
          await this.loadResponsiblePerson(transaction, body.plannerId, RoleCode.PLANNER);
        }
        const sequenceRows = await transaction.$queryRaw<Array<{ nextValue: bigint }>>`
          SELECT nextval('student_number_seq') AS "nextValue"
        `;
        const sequence = sequenceRows[0]?.nextValue;
        if (sequence === undefined) {
          throw new Error("Unable to allocate student number");
        }
        const studentNo = `DSE-${new Date().getUTCFullYear()}-${sequence
          .toString()
          .padStart(6, "0")}`;
        const created = await transaction.student.create({
          data: {
            studentNo,
            name,
            phone: this.optionalText(body.phone),
            email: this.optionalText(body.email)?.toLowerCase(),
            defaultButlerId: body.defaultButlerId ?? null,
            plannerId: body.plannerId ?? null,
            createdById: actor.id,
          },
          include: STUDENT_INCLUDE,
        });
        const initialChanges = [
          ...(body.defaultButlerId
            ? [
                {
                  studentId: created.id,
                  responsibilityType: "DEFAULT_BUTLER" as const,
                  previousUserId: null,
                  newUserId: body.defaultButlerId,
                  reason: "学生建档时分配",
                  operatorId: actor.id,
                },
              ]
            : []),
          ...(body.plannerId
            ? [
                {
                  studentId: created.id,
                  responsibilityType: "PLANNER" as const,
                  previousUserId: null,
                  newUserId: body.plannerId,
                  reason: "学生建档时分配",
                  operatorId: actor.id,
                },
              ]
            : []),
        ];
        if (initialChanges.length > 0) {
          await transaction.studentResponsibilityChange.createMany({ data: initialChanges });
        }
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "STUDENT_CREATED",
            objectId: created.id,
            afterData: this.auditSnapshot(created),
          }),
        });
        if (body.defaultButlerId) {
          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "STUDENT_DEFAULT_BUTLER_CHANGED",
              objectId: created.id,
              beforeData: { defaultButlerId: null },
              afterData: { defaultButlerId: body.defaultButlerId },
              reason: "学生建档时分配",
            }),
          });
        }
        if (body.plannerId) {
          await transaction.auditLog.create({
            data: this.auditData(request, {
              action: "STUDENT_PLANNER_CHANGED",
              objectId: created.id,
              beforeData: { plannerId: null },
              afterData: { plannerId: body.plannerId },
              reason: "学生建档时分配",
            }),
          });
        }
        return created;
      });
      return this.serializeStudent(student);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.STUDENT_NUMBER_CONFLICT,
          "学生编号冲突，请重试",
        );
      }
      throw error;
    }
  }

  public async detail(studentId: string) {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      include: STUDENT_DETAIL_INCLUDE,
    });
    if (!student) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
    }
    return this.serializeStudentDetail(student);
  }

  public async update(studentId: string, body: UpdateStudentDto, request: RequestContext) {
    try {
      const student = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.student.findUnique({
          where: { id: studentId },
          include: STUDENT_INCLUDE,
        });
        if (!existing) {
          throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
        }
        if (existing.version !== body.version) {
          throw this.versionConflict(existing.version);
        }
        const name = body.name === undefined ? undefined : body.name.trim();
        if (name !== undefined && !name) {
          throw new ApiException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.VALIDATION_ERROR,
            "学生姓名不能为空",
          );
        }
        const updateResult = await transaction.student.updateMany({
          where: { id: studentId, version: body.version },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(body.phone !== undefined ? { phone: this.optionalText(body.phone) } : {}),
            ...(body.email !== undefined
              ? { email: this.optionalText(body.email)?.toLowerCase() ?? null }
              : {}),
            version: { increment: 1 },
          },
        });
        if (updateResult.count !== 1) {
          const current = await transaction.student.findUniqueOrThrow({
            where: { id: studentId },
          });
          throw this.versionConflict(current.version);
        }
        const updated = await transaction.student.findUniqueOrThrow({
          where: { id: studentId },
          include: STUDENT_INCLUDE,
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action: "STUDENT_UPDATED",
            objectId: studentId,
            ...buildAuditDiff(this.auditSnapshot(existing), this.auditSnapshot(updated)),
            reason: body.reason,
          }),
        });
        return updated;
      });
      return this.serializeStudent(student);
    } catch (error) {
      await this.auditConflictIfNeeded(studentId, error, request);
      throw error;
    }
  }

  public async assignResponsiblePerson(
    studentId: string,
    responsibilityType: StudentResponsibilityType,
    body: AssignResponsiblePersonDto,
    request: RequestContext,
  ) {
    const roleCode = responsibilityType === "DEFAULT_BUTLER" ? RoleCode.BUTLER : RoleCode.PLANNER;
    const field = responsibilityType === "DEFAULT_BUTLER" ? "defaultButlerId" : "plannerId";
    try {
      const student = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.student.findUnique({
          where: { id: studentId },
          include: STUDENT_INCLUDE,
        });
        if (!existing) {
          throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
        }
        if (existing.version !== body.version) {
          throw this.versionConflict(existing.version);
        }
        if (body.userId) {
          await this.loadResponsiblePerson(transaction, body.userId, roleCode);
        }
        const previousUserId = existing[field];
        if (previousUserId === body.userId) {
          return existing;
        }
        const updateResult = await transaction.student.updateMany({
          where: { id: studentId, version: body.version },
          data: {
            [field]: body.userId,
            version: { increment: 1 },
          },
        });
        if (updateResult.count !== 1) {
          const current = await transaction.student.findUniqueOrThrow({
            where: { id: studentId },
          });
          throw this.versionConflict(current.version);
        }
        const actor = request.authenticatedUser as AuthenticatedUser;
        await transaction.studentResponsibilityChange.create({
          data: {
            studentId,
            responsibilityType,
            previousUserId,
            newUserId: body.userId,
            reason: body.reason.trim(),
            operatorId: actor.id,
          },
        });
        const updated = await transaction.student.findUniqueOrThrow({
          where: { id: studentId },
          include: STUDENT_INCLUDE,
        });
        await transaction.auditLog.create({
          data: this.auditData(request, {
            action:
              responsibilityType === "DEFAULT_BUTLER"
                ? "STUDENT_DEFAULT_BUTLER_CHANGED"
                : "STUDENT_PLANNER_CHANGED",
            objectId: studentId,
            beforeData: { [field]: previousUserId },
            afterData: { [field]: body.userId },
            reason: body.reason.trim(),
          }),
        });
        return updated;
      });
      return this.serializeStudent(student);
    } catch (error) {
      await this.auditConflictIfNeeded(studentId, error, request);
      throw error;
    }
  }

  private async loadResponsiblePerson(
    transaction: Prisma.TransactionClient,
    userId: string,
    roleCode: RoleCodeType,
  ) {
    const person = await transaction.user.findFirst({
      where: {
        id: userId,
        status: "ACTIVE",
        roles: { some: { expiredAt: null, role: { code: roleCode } } },
      },
      select: { id: true, displayName: true },
    });
    if (!person) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.RESPONSIBLE_PERSON_INVALID,
        roleCode === RoleCode.BUTLER ? "请选择有效的管家账号" : "请选择有效的规划老师账号",
      );
    }
    return person;
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.STUDENT_VERSION_CONFLICT,
      "学生资料已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private async auditConflictIfNeeded(studentId: string, error: unknown, request: RequestContext) {
    if (!(error instanceof ApiException) || error.code !== ErrorCode.STUDENT_VERSION_CONFLICT) {
      return;
    }
    await this.prisma.auditLog.create({
      data: this.auditData(request, {
        action: "STUDENT_UPDATE_CONFLICT",
        objectId: studentId,
        afterData: error.details as Prisma.InputJsonObject,
        reason: "过期版本提交被拒绝",
      }),
    });
  }

  private serializeStudent(student: StudentWithPeople) {
    return {
      id: student.id,
      studentNo: student.studentNo,
      name: student.name,
      phone: student.phone,
      email: student.email,
      defaultButler: student.defaultButler,
      planner: student.planner,
      serviceStatus: student.serviceStatus,
      version: student.version,
      createdBy: student.createdBy,
      createdAt: student.createdAt.toISOString(),
      updatedAt: student.updatedAt.toISOString(),
    };
  }

  private serializeStudentDetail(student: StudentWithHistory) {
    return {
      ...this.serializeStudent(student),
      sopVersion: null,
      taskSummary: {
        total: 0,
        todo: 0,
        inProgress: 0,
        completed: 0,
        overdue: 0,
        unassigned: 0,
      },
      responsibilityHistory: student.responsibilityChanges.map((change) => ({
        id: change.id,
        responsibilityType: change.responsibilityType,
        previousUser: change.previousUser,
        newUser: change.newUser,
        reason: change.reason,
        operator: change.operator,
        createdAt: change.createdAt.toISOString(),
      })),
    };
  }

  private auditSnapshot(student: StudentWithPeople): Prisma.InputJsonObject {
    return {
      studentNo: student.studentNo,
      name: student.name,
      phone: student.phone,
      email: student.email,
      defaultButlerId: student.defaultButlerId,
      plannerId: student.plannerId,
      serviceStatus: student.serviceStatus,
      version: student.version,
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
      objectType: "student",
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

  private optionalText(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    );
  }
}
