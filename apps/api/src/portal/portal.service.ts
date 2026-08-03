import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import type { PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { MaterialsService } from "../materials/materials.service.js";
import type { PortalUploadMaterialDto, RespondConfirmationDto } from "./portal.dto.js";

@Injectable()
export class PortalService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
  ) {}

  public async summary(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const [record, unreadCount] = await Promise.all([
      this.prisma.student.findUniqueOrThrow({
        where: { id: student.id },
        include: {
          serviceActivation: {
            include: {
              currentStage: true,
              stages: {
                include: {
                  tasks: {
                    where: { externalVisible: true, status: { in: ["TODO", "IN_PROGRESS"] } },
                    orderBy: { currentDueAt: "asc" },
                  },
                },
              },
            },
          },
          materialItems: {
            include: { materialType: true },
            orderBy: { dueAt: "asc" },
          },
          applications: { orderBy: { updatedAt: "desc" }, take: 5 },
          confirmations: {
            where: { status: "PENDING" },
            orderBy: { dueAt: "asc" },
          },
        },
      }),
      this.prisma.notification.count({
        where: { recipientId: (request.authenticatedUser as AuthenticatedUser).id, readAt: null },
      }),
    ]);
    const missingMaterials = record.materialItems.filter((item) =>
      ["REQUIRED", "PARTIALLY_MISSING", "RESUBMISSION_REQUIRED"].includes(item.status),
    );
    const tasks = record.serviceActivation?.stages.flatMap((stage) => stage.tasks) ?? [];
    return {
      student: {
        id: record.id,
        studentNo: record.studentNo,
        name: record.name,
        englishName: record.englishName,
        school: record.school,
        grade: record.grade,
        cohortYear: record.cohortYear,
      },
      serviceStatus: record.serviceStatus,
      progress: record.serviceActivation
        ? {
            completedStageCount: record.serviceActivation.completedStageCount,
            totalStageCount: 8,
            currentStage: record.serviceActivation.currentStage
              ? {
                  code: record.serviceActivation.currentStage.stageCodeSnapshot,
                  name: record.serviceActivation.currentStage.nameSnapshot,
                  sequenceNo: record.serviceActivation.currentStage.sequenceNoSnapshot,
                }
              : null,
            nextMilestone: record.nextMilestone,
          }
        : null,
      todo: {
        tasks: tasks.slice(0, 6).map((task) => ({
          id: task.id,
          title: task.titleSnapshot,
          dueAt: task.currentDueAt.toISOString(),
          status: task.status,
        })),
        missingMaterials: missingMaterials.slice(0, 6).map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          dueAt: item.dueAt?.toISOString() ?? null,
          expectedSubmitAt: item.expectedSubmitAt?.toISOString() ?? null,
        })),
        confirmations: record.confirmations.map((confirmation) => ({
          id: confirmation.id,
          prompt: confirmation.prompt,
          dueAt: confirmation.dueAt?.toISOString() ?? null,
        })),
      },
      applications: record.applications.map((application) => ({
        id: application.id,
        channel: application.channel,
        institutionName: application.institutionName,
        programName: application.programName,
        status: application.status,
        updatedAt: application.updatedAt.toISOString(),
      })),
      unreadNotificationCount: unreadCount,
    };
  }

  public async materialList(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const items = await this.prisma.materialItem.findMany({
      where: { studentId: student.id },
      include: {
        materialType: true,
        currentVersion: true,
        versions: { orderBy: { versionNo: "desc" } },
      },
      orderBy: [{ materialType: { isCore: "desc" } }, { dueAt: "asc" }],
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        materialType: {
          code: item.materialType.code,
          name: item.materialType.name,
          isCore: item.materialType.isCore,
        },
        requirement: item.requirement,
        dueAt: item.dueAt?.toISOString() ?? null,
        status: item.status,
        missingReason: item.missingReason,
        expectedSubmitAt: item.expectedSubmitAt?.toISOString() ?? null,
        currentVersion: item.currentVersion
          ? {
              id: item.currentVersion.id,
              versionNo: item.currentVersion.versionNo,
              fileName: item.currentVersion.fileName,
              reviewStatus: item.currentVersion.reviewStatus,
              reviewComment: item.currentVersion.reviewComment,
              uploadedAt: item.currentVersion.uploadedAt.toISOString(),
            }
          : null,
        versions: item.versions.map((version) => ({
          id: version.id,
          versionNo: version.versionNo,
          fileName: version.fileName,
          reviewStatus: version.reviewStatus,
          reviewComment: version.reviewComment,
          uploadedAt: version.uploadedAt.toISOString(),
          downloadUrl: `/api/v1/portal/me/material-versions/${version.id}/download`,
        })),
      })),
    };
  }

  public async uploadMaterial(
    materialId: string,
    body: PortalUploadMaterialDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materials.upload(materialId, body, request, student.id);
  }

  public async downloadMaterial(versionId: string, request: RequestContext) {
    const student = await this.access.portalStudent(request);
    return this.materials.download(versionId, request, student.id);
  }

  public async progress(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const activation = await this.prisma.studentServiceActivation.findUnique({
      where: { studentId: student.id },
      include: {
        currentStage: true,
        stages: {
          include: {
            tasks: {
              where: { externalVisible: true },
              orderBy: { currentDueAt: "asc" },
            },
          },
          orderBy: { sequenceNoSnapshot: "asc" },
        },
      },
    });
    if (!activation) return { serviceStatus: student.serviceStatus, progress: null, stages: [] };
    return {
      serviceStatus: student.serviceStatus,
      progress: {
        completedStageCount: activation.completedStageCount,
        totalStageCount: 8,
        currentStageCode: activation.currentStage?.stageCodeSnapshot ?? null,
        nextMilestone: student.nextMilestone,
      },
      stages: activation.stages.map((stage) => ({
        id: stage.id,
        code: stage.stageCodeSnapshot,
        name: stage.nameSnapshot,
        sequenceNo: stage.sequenceNoSnapshot,
        status: stage.status,
        startedAt: stage.startedAt?.toISOString() ?? null,
        completedAt: stage.completedAt?.toISOString() ?? null,
        tasks: stage.tasks.map((task) => ({
          id: task.id,
          title: task.titleSnapshot,
          status: task.status,
          dueAt: task.currentDueAt.toISOString(),
        })),
      })),
    };
  }

  public async applications(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const applications = await this.prisma.application.findMany({
      where: { studentId: student.id },
      include: {
        requirements: {
          where: { status: "OPEN" },
          orderBy: { dueAt: "asc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return {
      items: applications.map((application) => ({
        id: application.id,
        channel: application.channel,
        institutionName: application.institutionName,
        programName: application.programName,
        preferenceNo: application.preferenceNo,
        status: application.status,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        applicationNo: application.applicationNo,
        result: application.result,
        offerCondition: application.offerCondition,
        confirmationDeadline: application.confirmationDeadline?.toISOString() ?? null,
        updatedAt: application.updatedAt.toISOString(),
        reminders: application.requirements.map((requirement) => ({
          id: requirement.id,
          type: requirement.requirementType,
          description: requirement.description,
          dueAt: requirement.dueAt?.toISOString() ?? null,
        })),
      })),
    };
  }

  public async confirmations(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const items = await this.prisma.studentConfirmation.findMany({
      where: { studentId: student.id },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        objectType: item.objectType,
        objectId: item.objectId,
        prompt: item.prompt,
        status: item.status,
        responseNote: item.responseNote,
        respondedAt: item.respondedAt?.toISOString() ?? null,
        dueAt: item.dueAt?.toISOString() ?? null,
      })),
    };
  }

  public async respondConfirmation(
    confirmationId: string,
    body: RespondConfirmationDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const confirmation = await this.prisma.studentConfirmation.findFirst({
      where: { id: confirmationId, studentId: student.id },
    });
    if (!confirmation) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
        "待确认事项不存在",
      );
    }
    if (confirmation.status !== "PENDING") {
      throw new ApiException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, "该事项已经确认");
    }
    const updated = await this.prisma.studentConfirmation.update({
      where: { id: confirmation.id },
      data: {
        status: body.status,
        responseNote: body.note?.trim() || null,
        respondedById: actor.id,
        respondedAt: new Date(),
      },
    });
    await this.prisma.auditLog.create({
      data: {
        operatorId: actor.id,
        operatorRole: actor.roles[0] ?? null,
        objectType: "student_confirmation",
        objectId: confirmation.id,
        action: "PORTAL_CONFIRMATION_RESPONDED",
        afterData: { status: updated.status, responseNote: updated.responseNote },
        requestId: request.requestId,
        ipAddress: request.ip,
        deviceInfo: request.header("User-Agent"),
      },
    });
    return {
      id: updated.id,
      status: updated.status,
      respondedAt: updated.respondedAt?.toISOString(),
    };
  }
}
