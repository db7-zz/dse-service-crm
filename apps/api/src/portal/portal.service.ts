import { ErrorCode, type AuthenticatedUser } from "@dse/shared";
import type { PrismaClient } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import { PRISMA } from "../database/database.module.js";
import { MaterialsService } from "../materials/materials.service.js";
import { MaterialSubmissionsService } from "../materials/material-submissions.service.js";
import type {
  CreateMaterialSubmissionDto,
  RemoveMaterialSubmissionFileDto,
  RequestMaterialNotApplicableDto,
  WithdrawMaterialSubmissionDto,
} from "../materials/materials.dto.js";
import type {
  PortalUploadMaterialDto,
  RespondConfirmationDto,
  SubmitPortalProfileDto,
} from "./portal.dto.js";

@Injectable()
export class PortalService {
  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(MaterialsService) private readonly materials: MaterialsService,
    @Inject(MaterialSubmissionsService)
    private readonly materialSubmissions: MaterialSubmissionsService,
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
        status: publicApplicationStatus(application.status),
        updatedAt: application.updatedAt.toISOString(),
      })),
      unreadNotificationCount: unreadCount,
    };
  }

  public async profile(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const record = await this.prisma.student.findUniqueOrThrow({
      where: { id: student.id },
      include: { profileSubmission: true },
    });
    return {
      profileStatus: record.profileStatus,
      official: {
        studentName: record.name,
        cohortYear: record.cohortYear,
        grade: record.grade,
        school: record.school,
        studentPhone: record.phone,
        studentWechat: record.studentWechat,
        parentName: record.parentName,
        parentRelationship: record.parentRelationship,
        parentPhone: record.parentPhone,
        parentWechat: record.parentWechat,
        identityCategory: record.identityCategory,
        examCandidateType: record.examCandidateType,
        dseSubjects: record.dseSubjects,
        scoreSummary: record.scoreSummary,
        targetDirection: record.targetDirection,
      },
      submission: record.profileSubmission
        ? {
            data: record.profileSubmission.data,
            version: record.profileSubmission.version,
            submittedAt: record.profileSubmission.submittedAt.toISOString(),
            confirmedAt: record.profileSubmission.confirmedAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  public async submitProfile(body: SubmitPortalProfileDto, request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const submittedAt = new Date();
    const data = {
      studentName: body.studentName.trim(),
      cohortYear: body.cohortYear,
      grade: body.grade.trim(),
      school: body.school.trim(),
      studentPhone: body.studentPhone.trim(),
      studentWechat: body.studentWechat.trim(),
      parentName: body.parentName.trim(),
      parentRelationship: body.parentRelationship.trim(),
      parentPhone: body.parentPhone.trim(),
      parentWechat: body.parentWechat.trim(),
      identityCategory: body.identityCategory.trim(),
      examCandidateType: body.examCandidateType.trim(),
      dseSubjects: body.dseSubjects.map((subject) => subject.trim()).filter(Boolean),
      scoreSummary: body.scoreSummary.trim(),
      targetDirection: body.targetDirection.trim(),
    };
    const result = await this.prisma.$transaction(async (transaction) => {
      const submission = await transaction.studentProfileSubmission.upsert({
        where: { studentId: student.id },
        update: {
          data,
          submittedAt,
          confirmedAt: null,
          confirmedById: null,
          version: { increment: 1 },
        },
        create: { studentId: student.id, data, submittedAt },
      });
      const updated = await transaction.student.update({
        where: { id: student.id },
        data: { profileStatus: "PENDING_REVIEW", version: { increment: 1 } },
        select: { defaultButlerId: true },
      });
      await transaction.materialItem.updateMany({
        where: { studentId: student.id, materialType: { code: "BASIC_INFORMATION" } },
        data: { status: "PENDING_REVIEW", version: { increment: 1 } },
      });
      if (updated.defaultButlerId) {
        await transaction.notification.create({
          data: {
            recipientId: updated.defaultButlerId,
            eventType: "PROFILE_SUBMITTED",
            title: "学生基本信息待确认",
            content: `${student.name} 已提交基本信息表，请核对差异并确认建档。`,
            objectType: "student_profile_submission",
            objectId: submission.id,
            actionUrl: `/workspace/students/${student.id}`,
            eventKey: `profile-submitted:${submission.id}:v${submission.version}`,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          operatorId: actor.id,
          operatorRole: actor.roles[0] ?? null,
          objectType: "student_profile_submission",
          objectId: submission.id,
          action: "STUDENT_PROFILE_SUBMITTED",
          afterData: { studentId: student.id, version: submission.version },
          requestId: request.requestId,
          ipAddress: request.ip,
          deviceInfo: request.header("User-Agent"),
        },
      });
      return submission;
    });
    return {
      profileStatus: "PENDING_REVIEW" as const,
      version: result.version,
      submittedAt: result.submittedAt.toISOString(),
    };
  }

  public async materialList(request: RequestContext) {
    const student = await this.access.portalStudent(request);
    const items = await this.prisma.materialItem.findMany({
      where: { studentId: student.id },
      include: {
        materialType: true,
        sopMaterialTemplate: {
          include: {
            stageTemplate: {
              select: { stageCode: true, name: true, sequenceNo: true },
            },
          },
        },
        currentVersion: true,
        versions: { orderBy: { versionNo: "desc" } },
        currentSubmission: {
          include: { files: { where: { removedAt: null }, orderBy: { uploadedAt: "asc" } } },
        },
        submissions: {
          include: { files: { where: { removedAt: null }, orderBy: { uploadedAt: "asc" } } },
          orderBy: { submissionNo: "desc" },
        },
      },
      orderBy: [
        { materialType: { collectionPhase: "asc" } },
        { materialType: { sequenceNo: "asc" } },
      ],
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        title: item.title,
        materialType: {
          code: item.materialType.code,
          name: item.materialType.name,
          isCore: item.materialType.isCore,
          inputMode: item.materialType.inputMode,
          collectionPhase: item.materialType.collectionPhase,
          sequenceNo: item.materialType.sequenceNo,
        },
        requirement: item.requirement,
        sopMaterialTemplate: item.sopMaterialTemplate
          ? {
              id: item.sopMaterialTemplate.id,
              templateKey: item.sopMaterialTemplate.templateKey,
              sequenceNo: item.sopMaterialTemplate.sequenceNo,
              stage: item.sopMaterialTemplate.stageTemplate,
            }
          : null,
        origin: item.origin,
        requirementKind: item.requirementKind,
        conditionMatched: item.conditionMatched,
        deadlineRule: item.deadlineRule,
        dueAt: item.dueAt?.toISOString() ?? null,
        correctionDueAt: item.correctionDueAt?.toISOString() ?? null,
        status: item.status,
        missingReason: item.missingReason,
        expectedSubmitAt: item.expectedSubmitAt?.toISOString() ?? null,
        currentVersion: item.currentVersion
          ? {
              id: item.currentVersion.id,
              versionNo: item.currentVersion.versionNo,
              fileName: item.currentVersion.fileName,
              mimeType: item.currentVersion.mimeType,
              fileSize: item.currentVersion.fileSize,
              reviewStatus: item.currentVersion.reviewStatus,
              reviewComment: item.currentVersion.reviewComment,
              uploadedAt: item.currentVersion.uploadedAt.toISOString(),
              downloadUrl: `/api/v1/portal/me/material-versions/${item.currentVersion.id}/download`,
              previewUrl:
                item.currentVersion.mimeType === "application/pdf" ||
                item.currentVersion.mimeType.startsWith("image/")
                  ? `/api/v1/portal/me/material-versions/${item.currentVersion.id}/download?preview=true`
                  : null,
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
          previewUrl:
            version.mimeType === "application/pdf" || version.mimeType.startsWith("image/")
              ? `/api/v1/portal/me/material-versions/${version.id}/download?preview=true`
              : null,
        })),
        currentSubmission: item.currentSubmission
          ? this.serializePortalSubmission(item.currentSubmission)
          : null,
        submissions: item.submissions.map((submission) =>
          this.serializePortalSubmission(submission),
        ),
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

  public async createMaterialSubmission(
    materialId: string,
    body: CreateMaterialSubmissionDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.createDraft(materialId, body, request, student.id);
  }

  public async materialSubmissionDetail(submissionId: string, request: RequestContext) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.detail(submissionId, request, student.id);
  }

  public async addMaterialSubmissionFile(
    submissionId: string,
    body: PortalUploadMaterialDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.addFile(submissionId, body, request, student.id);
  }

  public async removeMaterialSubmissionFile(
    submissionId: string,
    fileId: string,
    body: RemoveMaterialSubmissionFileDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.removeFile(submissionId, fileId, body, request, student.id);
  }

  public async submitMaterialSubmission(submissionId: string, request: RequestContext) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.submit(submissionId, request, student.id);
  }

  public async withdrawMaterialSubmission(
    submissionId: string,
    body: WithdrawMaterialSubmissionDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.withdraw(submissionId, body, request, student.id);
  }

  public async requestMaterialNotApplicable(
    materialId: string,
    body: RequestMaterialNotApplicableDto,
    request: RequestContext,
  ) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.requestNotApplicable(materialId, body, request, student.id);
  }

  public async downloadMaterialSubmissionFile(fileId: string, request: RequestContext) {
    const student = await this.access.portalStudent(request);
    return this.materialSubmissions.downloadFile(fileId, request, student.id);
  }

  private serializePortalSubmission(submission: {
    id: string;
    submissionNo: number;
    status: string;
    source: string;
    submissionReason: string | null;
    submittedAt: Date | null;
    withdrawnAt: Date | null;
    reviewStartedAt: Date | null;
    reviewedAt: Date | null;
    reviewComment: string | null;
    correctionDueAt: Date | null;
    files: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      uploadedAt: Date;
      reviewStatus: string;
      reviewComment: string | null;
      copiedFromFileId: string | null;
    }>;
  }) {
    return {
      id: submission.id,
      submissionNo: submission.submissionNo,
      status: submission.status,
      source: submission.source,
      submissionReason: submission.submissionReason,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      withdrawnAt: submission.withdrawnAt?.toISOString() ?? null,
      reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
      reviewedAt: submission.reviewedAt?.toISOString() ?? null,
      reviewComment: submission.reviewComment,
      correctionDueAt: submission.correctionDueAt?.toISOString() ?? null,
      files: submission.files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        uploadedAt: file.uploadedAt.toISOString(),
        reviewStatus: file.reviewStatus,
        reviewComment: file.reviewComment,
        copiedFromFileId: file.copiedFromFileId,
        downloadUrl: `/api/v1/portal/me/material-submission-files/${file.id}/download`,
        previewUrl:
          file.mimeType === "application/pdf" || file.mimeType.startsWith("image/")
            ? `/api/v1/portal/me/material-submission-files/${file.id}/download?preview=true`
            : null,
      })),
    };
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
        status: publicApplicationStatus(application.status),
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

function publicApplicationStatus(status: string) {
  return status === "SUBMISSION_PENDING_EVIDENCE" ? "PENDING_SUBMISSION" : status;
}
