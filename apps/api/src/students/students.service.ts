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
  ConfirmStudentProfileDto,
  CreateStudentDto,
  ListStudentsQueryDto,
  UpdateStudentDto,
} from "./students.dto.js";

const STUDENT_INCLUDE = {
  defaultButler: { select: { id: true, displayName: true } },
  planner: { select: { id: true, displayName: true } },
  portalUser: {
    select: {
      id: true,
      username: true,
      status: true,
      mustChangePassword: true,
      temporaryPasswordExpiresAt: true,
    },
  },
  createdBy: { select: { id: true, displayName: true } },
} as const;

const STUDENT_LIST_INCLUDE = {
  ...STUDENT_INCLUDE,
  serviceActivation: {
    include: {
      currentStage: {
        select: {
          id: true,
          stageCodeSnapshot: true,
          nameSnapshot: true,
          sequenceNoSnapshot: true,
          status: true,
          version: true,
        },
      },
    },
  },
  stageInstances: {
    select: {
      id: true,
      status: true,
      tasks: {
        select: {
          stageInstanceId: true,
          status: true,
          currentDueAt: true,
          isBlockingSnapshot: true,
        },
      },
    },
  },
} as const;

const STUDENT_DETAIL_INCLUDE = {
  ...STUDENT_INCLUDE,
  serviceActivation: {
    include: {
      sopVersion: {
        select: {
          id: true,
          versionNo: true,
          status: true,
        },
      },
      enabledBy: { select: { id: true, displayName: true } },
      currentStage: {
        select: {
          id: true,
          stageCodeSnapshot: true,
          nameSnapshot: true,
          sequenceNoSnapshot: true,
          status: true,
          version: true,
        },
      },
    },
  },
  stageInstances: {
    orderBy: { sequenceNoSnapshot: "asc" as const },
    include: {
      tasks: {
        orderBy: { createdAt: "asc" as const },
        include: {
          owner: { select: { id: true, displayName: true } },
          taskTemplate: { select: { sequenceNo: true } },
        },
      },
      transitions: {
        orderBy: { createdAt: "asc" as const },
        include: {
          triggerTask: { select: { id: true, titleSnapshot: true } },
          calculationRun: { select: { id: true, type: true } },
        },
      },
    },
  },
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
type StudentWithProgress = Prisma.StudentGetPayload<{ include: typeof STUDENT_LIST_INCLUDE }>;
type StudentWithHistory = Prisma.StudentGetPayload<{ include: typeof STUDENT_DETAIL_INCLUDE }>;

interface SubmittedProfileData {
  studentName: string;
  cohortYear: number;
  grade: string;
  school: string;
  studentPhone: string;
  studentWechat: string;
  parentName: string;
  parentRelationship: string;
  parentPhone: string;
  parentWechat: string;
  identityCategory: string;
  examCandidateType: string;
  dseSubjects: string[];
  scoreSummary: string;
  targetDirection: string;
}

@Injectable()
export class StudentsService {
  public constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  public async list(
    input: ListStudentsQueryDto,
    forcedButlerId?: string,
    forcedPlannerId?: string,
  ) {
    const requestedPage = Math.max(1, Number(input.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(input.pageSize) || 20));
    const search = input.search?.trim();
    const baseConditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (input.serviceStatus) {
      baseConditions.push(
        Prisma.sql`student."service_status" = ${input.serviceStatus}::"StudentServiceStatus"`,
      );
    }
    const butlerId = forcedButlerId ?? input.defaultButlerId;
    if (butlerId) {
      baseConditions.push(Prisma.sql`student."default_butler_id" = ${butlerId}::uuid`);
    }
    const plannerId = forcedPlannerId ?? input.plannerId;
    if (plannerId) {
      baseConditions.push(Prisma.sql`student."planner_id" = ${plannerId}::uuid`);
    }
    if (input.school?.trim()) {
      baseConditions.push(Prisma.sql`student."school" ILIKE ${`%${input.school.trim()}%`}`);
    }
    if (input.grade?.trim()) {
      baseConditions.push(Prisma.sql`student."grade" = ${input.grade.trim()}`);
    }
    if (input.cohortYear) {
      baseConditions.push(Prisma.sql`student."cohort_year" = ${input.cohortYear}`);
    }
    if (input.riskLevel) {
      baseConditions.push(
        Prisma.sql`student."risk_level" = ${input.riskLevel}::"StudentRiskLevel"`,
      );
    }
    if (input.hasMissingMaterials !== undefined) {
      const missingMaterials = Prisma.sql`EXISTS (
        SELECT 1
        FROM "material_items" material
        JOIN "material_types" material_type ON material_type."id" = material."material_type_id"
        WHERE material."student_id" = student."id"
          AND material_type."is_core" = TRUE
          AND material."status" NOT IN ('APPROVED', 'NOT_APPLICABLE')
      )`;
      baseConditions.push(
        input.hasMissingMaterials ? missingMaterials : Prisma.sql`NOT (${missingMaterials})`,
      );
    }
    if (search) {
      baseConditions.push(Prisma.sql`(
        student."student_no" ILIKE ${`%${search}%`}
        OR student."name" ILIKE ${`%${search}%`}
        OR student."english_name" ILIKE ${`%${search}%`}
        OR student."school" ILIKE ${`%${search}%`}
        OR student."phone" ILIKE ${`%${search}%`}
        OR student."email" ILIKE ${`%${search}%`}
      )`);
    }

    const metricConditions: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (input.currentStageCode) {
      metricConditions.push(Prisma.sql`metrics."current_stage_code" = ${input.currentStageCode}`);
    }
    if (input.hasCurrentBlockers !== undefined) {
      metricConditions.push(
        input.hasCurrentBlockers
          ? Prisma.sql`metrics."current_blocker_count" > 0`
          : Prisma.sql`metrics."completed_stage_count" IS NOT NULL AND metrics."current_blocker_count" = 0`,
      );
    }

    const metricsCte = Prisma.sql`
      WITH student_metrics AS (
        SELECT
          student."id",
          student."created_at",
          activation."completed_stage_count",
          current_stage."stage_code_snapshot" AS "current_stage_code",
          COUNT(task."id") FILTER (
            WHERE task."stage_instance_id" = activation."current_stage_instance_id"
              AND task."is_blocking_snapshot" = TRUE
              AND task."status" IN ('TODO', 'IN_PROGRESS')
          )::INTEGER AS "current_blocker_count",
          COUNT(task."id") FILTER (
            WHERE task."status" IN ('TODO', 'IN_PROGRESS')
              AND task."current_due_at" < CURRENT_TIMESTAMP
          )::INTEGER AS "overdue_count"
        FROM "students" student
        LEFT JOIN "student_service_activations" activation
          ON activation."student_id" = student."id"
        LEFT JOIN "stage_instances" current_stage
          ON current_stage."id" = activation."current_stage_instance_id"
        LEFT JOIN "task_instances" task
          ON task."student_id" = student."id"
        WHERE ${Prisma.join(baseConditions, " AND ")}
        GROUP BY
          student."id",
          student."created_at",
          activation."completed_stage_count",
          current_stage."stage_code_snapshot"
      )
    `;
    const orderBy = this.studentProgressOrder(input.sortBy, input.sortOrder);

    return this.prisma.$transaction(async (transaction) => {
      const countRows = await transaction.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`
        ${metricsCte}
        SELECT COUNT(*)::BIGINT AS "total"
        FROM student_metrics metrics
        WHERE ${Prisma.join(metricConditions, " AND ")}
      `);
      const total = Number(countRows[0]?.total ?? 0n);
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, lastPage);
      const idRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        ${metricsCte}
        SELECT metrics."id"
        FROM student_metrics metrics
        WHERE ${Prisma.join(metricConditions, " AND ")}
        ORDER BY ${orderBy}
        LIMIT ${pageSize}
        OFFSET ${(page - 1) * pageSize}
      `);
      if (idRows.length === 0) return { items: [], page, pageSize, total };

      const students = await transaction.student.findMany({
        where: { id: { in: idRows.map(({ id }) => id) } },
        include: STUDENT_LIST_INCLUDE,
      });
      const byId = new Map(students.map((student) => [student.id, student]));
      const items = idRows.map(({ id }) => byId.get(id)).filter((student) => student !== undefined);
      return {
        items: items.map((student) => this.serializeStudentWithProgress(student)),
        page,
        pageSize,
        total,
      };
    });
  }

  public async responsiblePersonOptions() {
    const people = await this.prisma.user.findMany({
      where: {
        status: "ACTIVE",
        roles: {
          some: {
            expiredAt: null,
            role: { code: { in: [RoleCode.BUTLER, RoleCode.PLANNER, RoleCode.SPECIALIST] } },
          },
        },
      },
      select: {
        id: true,
        displayName: true,
        roles: {
          where: {
            expiredAt: null,
            role: { code: { in: [RoleCode.BUTLER, RoleCode.PLANNER, RoleCode.SPECIALIST] } },
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
      specialists: options.filter((person) => person.roleCodes.includes(RoleCode.SPECIALIST)),
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

  public async createMine(body: CreateStudentDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (!actor.roles.includes(RoleCode.BUTLER)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "只有管家可以新建本人负责的学生",
      );
    }
    return this.create(
      {
        name: body.name,
        phone: body.phone,
        email: body.email,
        defaultButlerId: actor.id,
        plannerId: null,
      },
      request,
    );
  }

  public async checkNameDuplicates(nameInput: string) {
    const name = nameInput.trim();
    if (!name) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "学生姓名不能为空",
      );
    }
    const count = await this.prisma.student.count({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    return { name, hasDuplicates: count > 0, count };
  }

  public async detail(studentId: string) {
    return this.serializeStudentDetail(await this.loadDetail(studentId));
  }

  public async listMine(input: ListStudentsQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const isPlanner = actor.roles.includes(RoleCode.PLANNER);
    const result = isPlanner
      ? await this.list(input, undefined, actor.id)
      : await this.list(input, actor.id);
    return {
      ...result,
      items: result.items.map((student) => ({
        id: student.id,
        studentNo: student.studentNo,
        name: student.name,
        englishName: student.englishName,
        school: student.school,
        grade: student.grade,
        cohortYear: student.cohortYear,
        riskLevel: student.riskLevel,
        nextMilestone: student.nextMilestone,
        defaultButler: student.defaultButler,
        planner: student.planner,
        account: student.account,
        serviceStatus: student.serviceStatus,
        profileStatus: student.profileStatus,
        version: student.version,
        progress: student.progress,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt,
      })),
    };
  }

  public async detailMine(studentId: string, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const isPlanner = actor.roles.includes(RoleCode.PLANNER);
    const student = await this.loadDetail(
      studentId,
      isPlanner ? undefined : actor.id,
      request,
      isPlanner ? actor.id : undefined,
    );
    const serialized = this.serializeStudentDetail(student);
    const detail = isPlanner
      ? this.redactTaskDetailsForPlanner(serialized)
      : this.redactTaskDetailsForButler(serialized, student, actor.id);
    return {
      id: detail.id,
      studentNo: detail.studentNo,
      name: detail.name,
      englishName: detail.englishName,
      school: detail.school,
      grade: detail.grade,
      cohortYear: detail.cohortYear,
      riskLevel: detail.riskLevel,
      nextMilestone: detail.nextMilestone,
      defaultButler: detail.defaultButler,
      planner: detail.planner,
      account: detail.account,
      serviceStatus: detail.serviceStatus,
      profileStatus: detail.profileStatus,
      phone: detail.phone,
      studentWechat: detail.studentWechat,
      parentName: detail.parentName,
      parentRelationship: detail.parentRelationship,
      parentPhone: detail.parentPhone,
      parentWechat: detail.parentWechat,
      identityCategory: detail.identityCategory,
      examCandidateType: detail.examCandidateType,
      dseSubjects: detail.dseSubjects,
      scoreSummary: detail.scoreSummary,
      targetDirection: detail.targetDirection,
      version: detail.version,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      activation: detail.activation,
      sopVersion: detail.sopVersion,
      taskSummary: detail.taskSummary,
      progress: detail.progress,
      stages: detail.stages,
    };
  }

  public async serviceProgress(studentId: string) {
    return this.progressResponse(this.serializeStudentDetail(await this.loadDetail(studentId)));
  }

  public async serviceProgressMine(studentId: string, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const isPlanner = actor.roles.includes(RoleCode.PLANNER);
    const student = await this.loadDetail(
      studentId,
      isPlanner ? undefined : actor.id,
      request,
      isPlanner ? actor.id : undefined,
    );
    const serialized = this.serializeStudentDetail(student);
    const detail = isPlanner
      ? this.redactTaskDetailsForPlanner(serialized)
      : this.redactTaskDetailsForButler(serialized, student, actor.id);
    return this.progressResponse(detail);
  }

  public async profileSubmissionMine(studentId: string, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, defaultButlerId: actor.id },
      include: { profileSubmission: true },
    });
    if (!student) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "只有该学生的管家可以确认档案",
      );
    }
    return {
      profileStatus: student.profileStatus,
      official: {
        studentName: student.name,
        cohortYear: student.cohortYear,
        grade: student.grade,
        school: student.school,
        studentPhone: student.phone,
        studentWechat: student.studentWechat,
        parentName: student.parentName,
        parentRelationship: student.parentRelationship,
        parentPhone: student.parentPhone,
        parentWechat: student.parentWechat,
        identityCategory: student.identityCategory,
        examCandidateType: student.examCandidateType,
        dseSubjects: student.dseSubjects,
        scoreSummary: student.scoreSummary,
        targetDirection: student.targetDirection,
      },
      submission: student.profileSubmission
        ? {
            id: student.profileSubmission.id,
            data: student.profileSubmission.data,
            version: student.profileSubmission.version,
            submittedAt: student.profileSubmission.submittedAt.toISOString(),
            confirmedAt: student.profileSubmission.confirmedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  public async confirmProfileSubmissionMine(
    studentId: string,
    body: ConfirmStudentProfileDto,
    request: RequestContext,
  ) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return this.prisma.$transaction(async (transaction) => {
      const student = await transaction.student.findFirst({
        where: { id: studentId, defaultButlerId: actor.id },
        include: { profileSubmission: true },
      });
      if (!student) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          "只有该学生的管家可以确认档案",
        );
      }
      const submission = student.profileSubmission;
      if (!submission) {
        throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "学生尚未提交基本信息表");
      }
      if (submission.version !== body.version) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          ErrorCode.CONFLICT,
          "学生刚刚更新了信息，请刷新后再确认",
        );
      }
      const data = submission.data as unknown as SubmittedProfileData;
      const confirmedAt = new Date();
      const updated = await transaction.student.update({
        where: { id: student.id },
        data: {
          name: data.studentName,
          cohortYear: data.cohortYear,
          grade: data.grade,
          school: data.school,
          phone: data.studentPhone,
          studentWechat: data.studentWechat,
          parentName: data.parentName,
          parentRelationship: data.parentRelationship,
          parentPhone: data.parentPhone,
          parentWechat: data.parentWechat,
          identityCategory: data.identityCategory,
          examCandidateType: data.examCandidateType,
          dseSubjects: data.dseSubjects,
          scoreSummary: data.scoreSummary,
          targetDirection: data.targetDirection,
          profileStatus: "CONFIRMED",
          profileConfirmedAt: confirmedAt,
          version: { increment: 1 },
        },
      });
      await transaction.studentProfileSubmission.update({
        where: { id: submission.id },
        data: { confirmedAt, confirmedById: actor.id },
      });
      const basicInformation = await transaction.materialItem.findFirst({
        where: { studentId, materialType: { code: "BASIC_INFORMATION" } },
        select: { id: true },
      });
      if (basicInformation) {
        await transaction.materialItem.update({
          where: { id: basicInformation.id },
          data: { status: "APPROVED", missingReason: null, version: { increment: 1 } },
        });
        const materialTask = await transaction.taskInstance.findFirst({
          where: {
            studentId,
            sourceType: "MATERIAL",
            sourceObjectId: basicInformation.id,
            status: { in: ["TODO", "IN_PROGRESS"] },
          },
        });
        if (materialTask) {
          await transaction.taskInstance.update({
            where: { id: materialTask.id },
            data: { status: "COMPLETED", completedAt: confirmedAt, version: { increment: 1 } },
          });
        }
      }
      await transaction.auditLog.create({
        data: this.auditData(request, {
          action: "STUDENT_PROFILE_CONFIRMED",
          objectId: student.id,
          beforeData: { profileStatus: student.profileStatus },
          afterData: { profileStatus: "CONFIRMED", submissionVersion: submission.version },
        }),
      });
      return { studentId, profileStatus: updated.profileStatus, version: updated.version };
    });
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
      const result = await this.prisma.$transaction(async (transaction) => {
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
          return { student: existing, transferredTaskCount: 0 };
        }
        const updateResult = await transaction.student.updateMany({
          where: { id: studentId, version: body.version },
          data: {
            [field]: body.userId,
            ...(responsibilityType === "PLANNER" && body.userId
              ? { profileStatus: "PLANNER_ASSIGNED" as const }
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
        let transferredTaskCount = 0;
        if (responsibilityType === "DEFAULT_BUTLER" && body.userId) {
          const transferableTasks = await transaction.taskInstance.findMany({
            where: {
              studentId,
              status: { in: ["TODO", "IN_PROGRESS"] },
              OR: [{ ownerId: previousUserId }, { ownerId: null }],
            },
            select: { id: true, ownerId: true, version: true },
          });
          for (const task of transferableTasks) {
            await transaction.taskInstance.update({
              where: { id: task.id },
              data: { ownerId: body.userId, version: { increment: 1 } },
            });
            await transaction.taskReassignment.create({
              data: {
                taskId: task.id,
                oldOwnerId: task.ownerId,
                newOwnerId: body.userId,
                reassignReason: body.reason.trim(),
                operatorId: actor.id,
              },
            });
            await transaction.taskTimelineEvent.create({
              data: {
                taskId: task.id,
                eventType: "REASSIGNED",
                actorId: actor.id,
                actorRole: actor.roles[0] ?? null,
                summary: "学生默认管家变更，系统同步交接未完成任务",
                reason: body.reason.trim(),
                beforeData: { ownerId: task.ownerId, version: task.version },
                afterData: { ownerId: body.userId, version: task.version + 1 },
              },
            });
          }
          transferredTaskCount = transferableTasks.length;
          await transaction.notification.create({
            data: {
              recipientId: body.userId,
              eventType: "STUDENT_RESPONSIBILITY_CHANGED",
              title: "学生服务已交接给你",
              content: `你已成为 ${existing.name} 的默认管家，共交接 ${transferredTaskCount} 项未完成任务。`,
              objectType: "student",
              objectId: studentId,
              actionUrl: `/workspace/students/${studentId}`,
            },
          });
        }
        if (responsibilityType === "PLANNER" && body.userId) {
          await transaction.notification.create({
            data: {
              recipientId: body.userId,
              eventType: "PLANNER_ASSIGNED",
              title: "收到新的规划学生",
              content: `${existing.name} 已分配给你，学生档案可开始规划评估。`,
              objectType: "student",
              objectId: studentId,
              actionUrl: `/workspace/students/${studentId}`,
              eventKey: `planner-assigned:${studentId}:${body.userId}`,
            },
          });
        }
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
        return { student: updated, transferredTaskCount };
      });
      return {
        ...this.serializeStudent(result.student),
        transferredTaskCount: result.transferredTaskCount,
      };
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
      englishName: student.englishName,
      school: student.school,
      grade: student.grade,
      cohortYear: student.cohortYear,
      studentWechat: student.studentWechat,
      parentName: student.parentName,
      parentRelationship: student.parentRelationship,
      parentPhone: student.parentPhone,
      parentWechat: student.parentWechat,
      identityCategory: student.identityCategory,
      examCandidateType: student.examCandidateType,
      dseSubjects: student.dseSubjects,
      scoreSummary: student.scoreSummary,
      targetDirection: student.targetDirection,
      profileStatus: student.profileStatus,
      phone: student.phone,
      email: student.email,
      nextMilestone: student.nextMilestone,
      riskLevel: student.riskLevel,
      riskNote: student.riskNote,
      defaultButler: student.defaultButler,
      planner: student.planner,
      account: student.portalUser
        ? {
            id: student.portalUser.id,
            username: student.portalUser.username,
            status: student.portalUser.status,
            mustChangePassword: student.portalUser.mustChangePassword,
            temporaryPasswordExpiresAt:
              student.portalUser.temporaryPasswordExpiresAt?.toISOString() ?? null,
          }
        : null,
      serviceStatus: student.serviceStatus,
      version: student.version,
      createdBy: student.createdBy,
      createdAt: student.createdAt.toISOString(),
      updatedAt: student.updatedAt.toISOString(),
    };
  }

  private serializeStudentWithProgress(student: StudentWithProgress) {
    return {
      ...this.serializeStudent(student),
      progress: this.progressSummary(student),
    };
  }

  private serializeStudentDetail(student: StudentWithHistory) {
    const tasks = student.stageInstances.flatMap((stage) => stage.tasks);
    const now = Date.now();
    return {
      ...this.serializeStudent(student),
      activation: student.serviceActivation
        ? {
            id: student.serviceActivation.id,
            enabledAt: student.serviceActivation.enabledAt.toISOString(),
            enabledBy: student.serviceActivation.enabledBy,
          }
        : null,
      sopVersion: student.serviceActivation
        ? {
            id: student.serviceActivation.sopVersion.id,
            versionNo: student.serviceActivation.sopVersion.versionNo,
            displayVersion: `v${student.serviceActivation.sopVersion.versionNo}`,
            status: student.serviceActivation.sopVersion.status,
          }
        : null,
      taskSummary: {
        total: tasks.length,
        todo: tasks.filter((task) => task.status === "TODO").length,
        inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
        completed: tasks.filter((task) => task.status === "COMPLETED").length,
        canceled: tasks.filter((task) => task.status === "CANCELED").length,
        notApplicable: tasks.filter((task) => task.status === "NOT_APPLICABLE").length,
        overdue: tasks.filter(
          (task) =>
            (task.status === "TODO" || task.status === "IN_PROGRESS") &&
            task.currentDueAt.getTime() < now,
        ).length,
        unassigned: tasks.filter(
          (task) => !task.ownerId && (task.status === "TODO" || task.status === "IN_PROGRESS"),
        ).length,
        completionRate: this.taskCompletionRate(tasks),
      },
      progress: this.progressSummary(student),
      stages: student.stageInstances.map((stage) => ({
        id: stage.id,
        stageCode: stage.stageCodeSnapshot,
        name: stage.nameSnapshot,
        sequenceNo: stage.sequenceNoSnapshot,
        description: stage.descriptionSnapshot,
        status: stage.status,
        startedAt: stage.startedAt?.toISOString() ?? null,
        completedAt: stage.completedAt?.toISOString() ?? null,
        completionReason: stage.completionReason,
        version: stage.version,
        openBlockingTaskCount: stage.tasks.filter(
          (task) =>
            task.isBlockingSnapshot && (task.status === "TODO" || task.status === "IN_PROGRESS"),
        ).length,
        transitions: stage.transitions.map((transition) => ({
          id: transition.id,
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          triggerType: transition.triggerType,
          summary: transition.summary,
          triggerTask: transition.triggerTask
            ? { id: transition.triggerTask.id, title: transition.triggerTask.titleSnapshot }
            : null,
          calculationRun: transition.calculationRun,
          createdAt: transition.createdAt.toISOString(),
        })),
        tasks: stage.tasks.map((task) => ({
          id: task.id,
          title: task.titleSnapshot,
          sequenceNo: task.taskTemplate?.sequenceNo ?? null,
          sourceType: task.sourceType,
          isBlocking: task.isBlockingSnapshot,
          isLegacy:
            stage.status === "COMPLETED" &&
            !task.isBlockingSnapshot &&
            (task.status === "TODO" || task.status === "IN_PROGRESS"),
          status: task.status,
          owner: task.owner,
          currentDueAt: task.currentDueAt.toISOString(),
          isOverdue:
            (task.status === "TODO" || task.status === "IN_PROGRESS") &&
            task.currentDueAt.getTime() < now,
          version: task.version,
        })),
      })),
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

  private progressSummary(student: StudentWithProgress | StudentWithHistory) {
    const activation = student.serviceActivation;
    if (!activation) return null;
    const tasks = student.stageInstances.flatMap((stage) => stage.tasks);
    const now = Date.now();
    const currentStageId = activation.currentStageInstanceId;
    return {
      calculationStatus: activation.calculationStatus,
      calculationErrorCode: activation.calculationErrorCode,
      lastCalculatedAt: activation.lastCalculatedAt?.toISOString() ?? null,
      progressVersion: activation.progressVersion,
      completedStageCount: activation.completedStageCount,
      totalStageCount: 8,
      currentStage: activation.currentStage
        ? {
            id: activation.currentStage.id,
            code: activation.currentStage.stageCodeSnapshot,
            name: activation.currentStage.nameSnapshot,
            sequenceNo: activation.currentStage.sequenceNoSnapshot,
            status: activation.currentStage.status,
            version: activation.currentStage.version,
          }
        : null,
      currentBlockingTaskCount: tasks.filter(
        (task) =>
          task.stageInstanceId === currentStageId &&
          task.isBlockingSnapshot &&
          (task.status === "TODO" || task.status === "IN_PROGRESS"),
      ).length,
      overdueTaskCount: tasks.filter(
        (task) =>
          (task.status === "TODO" || task.status === "IN_PROGRESS") &&
          task.currentDueAt.getTime() < now,
      ).length,
      legacyTaskCount: student.stageInstances.reduce(
        (total, stage) =>
          total +
          (stage.status === "COMPLETED"
            ? stage.tasks.filter(
                (task) =>
                  !task.isBlockingSnapshot &&
                  (task.status === "TODO" || task.status === "IN_PROGRESS"),
              ).length
            : 0),
        0,
      ),
      taskCompletionRate: this.taskCompletionRate(tasks),
    };
  }

  private taskCompletionRate(tasks: Array<{ status: string }>) {
    const denominator = tasks.filter(
      (task) => task.status !== "CANCELED" && task.status !== "NOT_APPLICABLE",
    ).length;
    if (denominator === 0) return null;
    return tasks.filter((task) => task.status === "COMPLETED").length / denominator;
  }

  private studentProgressOrder(
    sortBy: ListStudentsQueryDto["sortBy"],
    sortOrder: ListStudentsQueryDto["sortOrder"],
  ) {
    if (!sortBy) return Prisma.sql`metrics."created_at" DESC, metrics."id" DESC`;
    const ascending = sortOrder === "asc";
    if (sortBy === "stageProgress") {
      return ascending
        ? Prisma.sql`metrics."completed_stage_count" ASC NULLS FIRST, metrics."created_at" DESC, metrics."id" DESC`
        : Prisma.sql`metrics."completed_stage_count" DESC NULLS LAST, metrics."created_at" DESC, metrics."id" DESC`;
    }
    if (sortBy === "currentBlockers") {
      return ascending
        ? Prisma.sql`metrics."current_blocker_count" ASC, metrics."created_at" DESC, metrics."id" DESC`
        : Prisma.sql`metrics."current_blocker_count" DESC, metrics."created_at" DESC, metrics."id" DESC`;
    }
    return ascending
      ? Prisma.sql`metrics."overdue_count" ASC, metrics."created_at" DESC, metrics."id" DESC`
      : Prisma.sql`metrics."overdue_count" DESC, metrics."created_at" DESC, metrics."id" DESC`;
  }

  private async loadDetail(
    studentId: string,
    forcedButlerId?: string,
    request?: RequestContext,
    forcedPlannerId?: string,
  ) {
    const student = await this.prisma.student.findFirst({
      where: {
        id: studentId,
        ...(forcedButlerId ? { defaultButlerId: forcedButlerId } : {}),
        ...(forcedPlannerId ? { plannerId: forcedPlannerId } : {}),
      },
      include: STUDENT_DETAIL_INCLUDE,
    });
    if (student) return student;
    const exists = await this.prisma.student.count({ where: { id: studentId } });
    if (exists > 0 && (forcedButlerId || forcedPlannerId)) {
      if (request) {
        const actor = request.authenticatedUser as AuthenticatedUser;
        await this.prisma.auditLog.create({
          data: {
            operatorId: actor.id,
            operatorRole: actor.roles[0] ?? null,
            objectType: "student_service_progress",
            objectId: studentId,
            action: "STUDENT_PROGRESS_ACCESS_DENIED",
            reason: forcedPlannerId ? "当前用户不是学生的规划老师" : "当前用户不是学生的默认管家",
            requestId: request.requestId,
            ipAddress: request.ip,
            deviceInfo: request.header("User-Agent"),
          },
        });
      }
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权查看该学生服务进度");
    }
    throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "学生不存在");
  }

  private progressResponse(detail: ReturnType<StudentsService["serializeStudentDetail"]>) {
    return {
      student: { id: detail.id, studentNo: detail.studentNo, name: detail.name },
      serviceStatus: detail.serviceStatus,
      activation: detail.activation,
      sopVersion: detail.sopVersion,
      progress: detail.progress,
      taskSummary: detail.taskSummary,
      stages: detail.stages,
    };
  }

  private redactTaskDetailsForButler(
    detail: ReturnType<StudentsService["serializeStudentDetail"]>,
    student: StudentWithHistory,
    butlerId: string,
  ) {
    const allowedTaskIds = new Set(
      student.stageInstances.flatMap((stage) =>
        stage.tasks.filter((task) => task.ownerId === butlerId).map((task) => task.id),
      ),
    );
    return {
      ...detail,
      stages: detail.stages.map((stage) => ({
        ...stage,
        tasks: stage.tasks.filter((task) => allowedTaskIds.has(task.id)),
        transitions: stage.transitions.map((transition) => ({
          ...transition,
          triggerTask:
            transition.triggerTask && allowedTaskIds.has(transition.triggerTask.id)
              ? transition.triggerTask
              : null,
        })),
      })),
    };
  }

  private redactTaskDetailsForPlanner(
    detail: ReturnType<StudentsService["serializeStudentDetail"]>,
  ) {
    return {
      ...detail,
      stages: detail.stages.map((stage) => ({
        ...stage,
        tasks: [],
        transitions: stage.transitions.map((transition) => ({
          ...transition,
          triggerTask: null,
        })),
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
