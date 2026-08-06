import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import type { Prisma, PrismaClient } from "@dse/database";
import { ConfigService } from "@nestjs/config";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import type { Environment } from "../config/environment.js";
import { PRISMA } from "../database/database.module.js";
import type {
  AcceptStudentHandoffDto,
  CreateStudentHandoffDto,
  ListStudentHandoffsQueryDto,
} from "./student-handoffs.dto.js";
import { StudentWorkflowService } from "./student-workflow.service.js";
import { StudentsService } from "./students.service.js";

const HANDOFF_INCLUDE = {
  assignedButler: { select: { id: true, displayName: true } },
  createdBy: { select: { id: true, displayName: true } },
  acceptedBy: { select: { id: true, displayName: true } },
  student: {
    select: {
      id: true,
      studentNo: true,
      serviceStatus: true,
      profileStatus: true,
      portalUser: { select: { id: true, username: true, status: true } },
    },
  },
} as const;

type HandoffWithRelations = Prisma.SignedStudentHandoffGetPayload<{
  include: typeof HANDOFF_INCLUDE;
}>;

@Injectable()
export class StudentHandoffsService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentsService) private readonly students: StudentsService,
    @Inject(StudentWorkflowService) private readonly workflow: StudentWorkflowService,
    @Inject(ConfigService) private readonly config: ConfigService<Environment, true>,
  ) {}

  public async list(query: ListStudentHandoffsQueryDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const page = Math.max(1, query.page);
    const pageSize = Math.min(100, Math.max(1, query.pageSize));
    const where = actor.roles.includes(RoleCode.ADMINISTRATOR)
      ? {}
      : { assignedButlerId: actor.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.signedStudentHandoff.findMany({
        where,
        include: HANDOFF_INCLUDE,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.signedStudentHandoff.count({ where }),
    ]);
    return { items: items.map((item) => this.serialize(item)), page, pageSize, total };
  }

  public async create(body: CreateStudentHandoffDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    const butler = await this.prisma.user.findFirst({
      where: {
        id: body.assignedButlerId,
        status: "ACTIVE",
        roles: { some: { expiredAt: null, role: { code: RoleCode.BUTLER } } },
      },
      select: { id: true, displayName: true },
    });
    if (!butler) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.RESPONSIBLE_PERSON_INVALID,
        "所选管家不可用，请刷新后重新选择",
      );
    }
    const created = await this.prisma.$transaction(async (transaction) => {
      const handoff = await transaction.signedStudentHandoff.create({
        data: {
          studentName: body.studentName.trim(),
          studentPhone: this.optionalText(body.studentPhone),
          studentWechat: this.optionalText(body.studentWechat),
          parentName: body.parentName.trim(),
          parentRelationship: this.optionalText(body.parentRelationship),
          parentPhone: body.parentPhone.trim(),
          parentWechat: this.optionalText(body.parentWechat),
          school: this.optionalText(body.school),
          grade: this.optionalText(body.grade),
          cohortYear: body.cohortYear ?? null,
          assignedButlerId: butler.id,
          wechatGroupCreatedAt: new Date(body.wechatGroupCreatedAt),
          createdById: actor.id,
        },
        include: HANDOFF_INCLUDE,
      });
      await transaction.notification.create({
        data: {
          recipientId: butler.id,
          eventType: "HANDOFF_ASSIGNED",
          title: "收到新的签约学生交接",
          content: `${body.studentName.trim()} 已进入服务群，请确认接手并开通学生端。`,
          objectType: "student_handoff",
          objectId: handoff.id,
          actionUrl: "/workspace/handoffs",
          eventKey: `handoff-assigned:${handoff.id}:${butler.id}`,
        },
      });
      await transaction.auditLog.create({
        data: {
          operatorId: actor.id,
          operatorRole: actor.roles[0] ?? null,
          objectType: "student_handoff",
          objectId: handoff.id,
          action: "STUDENT_HANDOFF_CREATED",
          afterData: {
            studentName: handoff.studentName,
            assignedButlerId: handoff.assignedButlerId,
            wechatGroupCreatedAt: handoff.wechatGroupCreatedAt.toISOString(),
          },
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      });
      return handoff;
    });
    return this.serialize(created);
  }

  public async accept(handoffId: string, body: AcceptStudentHandoffDto, request: RequestContext) {
    const actor = request.authenticatedUser as AuthenticatedUser;
    let handoff = await this.prisma.signedStudentHandoff.findUnique({
      where: { id: handoffId },
      include: HANDOFF_INCLUDE,
    });
    if (!handoff) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "签约交接不存在");
    }
    if (handoff.assignedButlerId !== actor.id) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "只有被分配的管家可以接手");
    }
    if (handoff.status === "CANCELED") {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "该交接已取消");
    }
    if (handoff.version !== body.version && handoff.status !== "ACCEPTED") {
      throw new ApiException(
        HttpStatus.CONFLICT,
        ErrorCode.CONFLICT,
        "交接状态已更新，请刷新后重试",
      );
    }

    let studentId = handoff.studentId;
    if (!studentId) {
      const draft = await this.students.create(
        {
          name: handoff.studentName,
          phone: handoff.studentPhone,
          defaultButlerId: actor.id,
          plannerId: null,
        },
        request,
      );
      studentId = draft.id;
      await this.prisma.student.update({
        where: { id: studentId },
        data: {
          studentWechat: handoff.studentWechat,
          parentName: handoff.parentName,
          parentRelationship: handoff.parentRelationship,
          parentPhone: handoff.parentPhone,
          parentWechat: handoff.parentWechat,
          school: handoff.school,
          grade: handoff.grade,
          cohortYear: handoff.cohortYear,
          version: { increment: 1 },
        },
      });
      await this.prisma.signedStudentHandoff.update({
        where: { id: handoff.id },
        data: { studentId },
      });
    }

    const student = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { version: true, serviceStatus: true, portalUserId: true },
    });
    const activation =
      student.serviceStatus === "NOT_ENABLED"
        ? await this.workflow.activate(studentId, { version: student.version }, request)
        : await this.workflow.resetPortalAccount(studentId, request);

    handoff = await this.prisma.signedStudentHandoff.update({
      where: { id: handoff.id },
      data: {
        status: "ACCEPTED",
        acceptedById: actor.id,
        acceptedAt: new Date(),
        version: { increment: handoff.status === "ACCEPTED" ? 0 : 1 },
      },
      include: HANDOFF_INCLUDE,
    });
    const origin = this.config.get("APP_ORIGIN", { infer: true }).replace(/\/$/, "");
    const account = activation.account;
    const onboardingMessage = [
      `你好，${handoff.studentName}的DSE升学服务已开通。`,
      `平台地址：${origin}/login`,
      `登录账号：${account.username}`,
      `临时密码：${account.temporaryPassword}`,
      "首次登录后请立即修改密码。学生与家长可共同使用该账号，先在线填写基本信息表，再按“当前需提交”清单上传资料；后续资料会在对应阶段开放。",
    ].join("\n");
    return {
      handoff: this.serialize(handoff),
      studentId,
      account,
      onboardingMessage,
    };
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private serialize(item: HandoffWithRelations) {
    return {
      ...item,
      wechatGroupCreatedAt: item.wechatGroupCreatedAt.toISOString(),
      acceptedAt: item.acceptedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }
}
