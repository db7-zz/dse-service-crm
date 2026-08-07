import path from "node:path";
import { ConfigService } from "@nestjs/config";
import { ErrorCode, RoleCode, type AuthenticatedUser } from "@dse/shared";
import { Prisma, type PrismaClient, type TaskStatus } from "@dse/database";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { StudentAccessService } from "../access/student-access.service.js";
import { ApiException } from "../common/api-exception.js";
import type { RequestContext } from "../common/request-context.js";
import type { Environment } from "../config/environment.js";
import { PRISMA } from "../database/database.module.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { ServiceProgressService } from "../students/service-progress.service.js";
import type {
  CancelSpecialMaterialDto,
  CreateMaterialSubmissionDto,
  RemoveMaterialSubmissionFileDto,
  RequestMaterialNotApplicableDto,
  ReviewMaterialApplicabilityDto,
  ReviewMaterialSubmissionDto,
  UploadMaterialVersionDto,
  WithdrawMaterialSubmissionDto,
} from "./materials.dto.js";
import { FileStorageService } from "./file-storage.service.js";
import {
  canCreateMaterialSubmissionDraft,
  materialSubmissionReviewAccess,
  materialSubmissionReviewCoverageError,
} from "./material-submission.logic.js";

const ALLOWED_FILES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
};

const PLANNER_VISIBLE_MATERIAL_CODES = [
  "BASIC_INFORMATION",
  "SELF_RECOMMENDATION",
  "TRANSCRIPT",
  "RECOMMENDATION",
  "ACTIVITY_EVIDENCE",
  "PREDICTED_GRADES",
  "LANGUAGE_SCORE",
];

const SUBMISSION_INCLUDE = {
  createdBy: { select: { id: true, displayName: true } },
  submittedBy: { select: { id: true, displayName: true } },
  reviewStartedBy: { select: { id: true, displayName: true } },
  reviewedBy: { select: { id: true, displayName: true } },
  files: {
    include: {
      uploadedBy: { select: { id: true, displayName: true } },
      reviewedBy: { select: { id: true, displayName: true } },
      removedBy: { select: { id: true, displayName: true } },
    },
    orderBy: { uploadedAt: "asc" as const },
  },
  materialItem: {
    include: {
      materialType: true,
      student: {
        select: {
          id: true,
          name: true,
          defaultButlerId: true,
          plannerId: true,
          portalUserId: true,
        },
      },
    },
  },
} as const;

type SubmissionWithContent = Prisma.MaterialSubmissionGetPayload<{
  include: typeof SUBMISSION_INCLUDE;
}>;

@Injectable()
export class MaterialSubmissionsService {
  private readonly maxUploadBytes: number;

  public constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ConfigService) config: ConfigService<Environment, true>,
    @Inject(StudentAccessService) private readonly access: StudentAccessService,
    @Inject(FileStorageService) private readonly storage: FileStorageService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ServiceProgressService) private readonly progress: ServiceProgressService,
  ) {
    this.maxUploadBytes = config.get("MAX_UPLOAD_BYTES", { infer: true });
  }

  public async detail(submissionId: string, request: RequestContext, expectedStudentId?: string) {
    return this.serializeSubmission(
      await this.loadAccessible(submissionId, request, expectedStudentId),
      Boolean(expectedStudentId),
    );
  }

  public async createDraft(
    materialId: string,
    body: CreateMaterialSubmissionDto,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const item = await this.loadItem(materialId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    const source = expectedStudentId ? ("STUDENT" as const) : ("BUTLER" as const);
    if (!expectedStudentId) {
      if (!actor.roles.includes(RoleCode.BUTLER) || item.student.defaultButlerId !== actor.id) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          "只有该学生的负责管家可以代传资料",
        );
      }
      if (!this.optionalText(body.reason)) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
          "管家代传必须填写原因",
        );
      }
    }
    if (!canCreateMaterialSubmissionDraft(item.status, item.applicabilityRequests.length > 0)) {
      throw this.stateConflict("该资料当前不能创建上传草稿");
    }

    const created = await this.prisma
      .$transaction(async (transaction) => {
        const activeDraft = await transaction.materialSubmission.findFirst({
          where: { materialItemId: item.id, status: "DRAFT" },
          select: { id: true },
        });
        if (activeDraft) throw this.stateConflict("该资料已有未提交草稿");
        const latest = await transaction.materialSubmission.aggregate({
          where: { materialItemId: item.id },
          _max: { submissionNo: true },
        });
        const submission = await transaction.materialSubmission.create({
          data: {
            materialItemId: item.id,
            submissionNo: (latest._max.submissionNo ?? 0) + 1,
            source,
            createdById: actor.id,
            submissionReason: source === "BUTLER" ? body.reason!.trim() : null,
          },
        });
        if (item.currentSubmission?.status === "NEEDS_CORRECTION") {
          const approvedFiles = item.currentSubmission.files.filter(
            (file) => file.removedAt === null && file.reviewStatus === "APPROVED",
          );
          if (approvedFiles.length > 0) {
            await transaction.materialSubmissionFile.createMany({
              data: approvedFiles.map((file) => ({
                submissionId: submission.id,
                fileName: file.fileName,
                mimeType: file.mimeType,
                fileSize: file.fileSize,
                storageKey: file.storageKey,
                fileHash: file.fileHash,
                uploadedById: file.uploadedById,
                uploadedAt: file.uploadedAt,
                reviewStatus: "APPROVED" as const,
                reviewedById: file.reviewedById,
                reviewedAt: file.reviewedAt,
                reviewComment: file.reviewComment,
                copiedFromFileId: file.id,
              })),
            });
          }
        }
        await transaction.materialItem.update({
          where: { id: item.id },
          data: {
            currentSubmissionId: submission.id,
            status: "DRAFT",
            version: { increment: 1 },
          },
        });
        await transaction.auditLog.create({
          data: this.audit(
            request,
            "material_submission",
            submission.id,
            "MATERIAL_DRAFT_CREATED",
            {
              materialId: item.id,
              studentId: item.studentId,
              submissionNo: submission.submissionNo,
              source,
              reason: body.reason ?? null,
            },
          ),
        });
        return submission.id;
      })
      .catch((error: unknown) => {
        if (this.isPrismaCode(error, "P2002")) {
          throw this.stateConflict("该资料已有草稿或批次编号已被其他操作占用");
        }
        throw error;
      });
    return this.loadSerialized(created, Boolean(expectedStudentId));
  }

  public async addFile(
    submissionId: string,
    body: UploadMaterialVersionDto,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const submission = await this.loadAccessible(submissionId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertDraftOwner(submission, actor.id);
    const content = this.decodeAndValidateFile(body);
    if (body.replacesFileId) {
      const replaced = await this.prisma.materialSubmissionFile.findFirst({
        where: {
          id: body.replacesFileId,
          submission: { materialItemId: submission.materialItemId },
          reviewStatus: "REJECTED",
          removedAt: null,
        },
      });
      if (!replaced) throw this.stateConflict("被替换的问题文件不存在或状态已变化");
    }
    const stored = await this.storage.put({
      namespace: "materials",
      ownerId: submission.materialItem.studentId,
      fileName: body.fileName,
      content,
    });
    const file = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.materialSubmissionFile.create({
        data: {
          submissionId: submission.id,
          fileName: body.fileName.trim(),
          mimeType: body.mimeType,
          fileSize: content.length,
          storageKey: stored.storageKey,
          fileHash: stored.fileHash,
          uploadedById: actor.id,
          copiedFromFileId: body.replacesFileId ?? null,
        },
      });
      await transaction.auditLog.create({
        data: this.audit(
          request,
          "material_submission_file",
          created.id,
          "MATERIAL_DRAFT_FILE_ADDED",
          {
            submissionId: submission.id,
            materialId: submission.materialItemId,
            fileName: created.fileName,
            fileSize: created.fileSize,
            fileHash: created.fileHash,
            replacesFileId: body.replacesFileId ?? null,
          },
        ),
      });
      return created;
    });
    return this.serializeFile(file, Boolean(expectedStudentId));
  }

  public async removeFile(
    submissionId: string,
    fileId: string,
    body: RemoveMaterialSubmissionFileDto,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const submission = await this.loadAccessible(submissionId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertDraftOwner(submission, actor.id);
    const file = submission.files.find(
      (candidate) => candidate.id === fileId && !candidate.removedAt,
    );
    if (!file)
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "草稿文件不存在");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.materialSubmissionFile.update({
        where: { id: file.id },
        data: {
          removedAt: new Date(),
          removedById: actor.id,
          removalReason: body.reason.trim(),
        },
      });
      await transaction.auditLog.create({
        data: this.audit(
          request,
          "material_submission_file",
          file.id,
          "MATERIAL_DRAFT_FILE_REMOVED",
          {
            submissionId: submission.id,
            reason: body.reason.trim(),
          },
        ),
      });
    });
    return this.loadSerialized(submission.id, Boolean(expectedStudentId));
  }

  public async submit(submissionId: string, request: RequestContext, expectedStudentId?: string) {
    const submission = await this.loadAccessible(submissionId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertDraftOwner(submission, actor.id);
    const files = submission.files.filter((file) => !file.removedAt);
    if (files.length === 0 || !files.some((file) => file.reviewStatus === "PENDING")) {
      throw this.stateConflict("提交审核前至少需要上传一个新文件");
    }
    const submittedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const changedSubmission = await transaction.materialSubmission.updateMany({
        where: { id: submission.id, status: "DRAFT", createdById: actor.id },
        data: {
          status: "PENDING_REVIEW",
          submittedById: actor.id,
          submittedAt,
        },
      });
      if (changedSubmission.count !== 1) throw this.stateConflict("草稿状态已变化，请刷新后重试");
      const changedItem = await transaction.materialItem.updateMany({
        where: {
          id: submission.materialItemId,
          currentSubmissionId: submission.id,
          status: "DRAFT",
        },
        data: {
          currentSubmissionId: submission.id,
          status: "PENDING_REVIEW",
          version: { increment: 1 },
        },
      });
      if (changedItem.count !== 1) throw this.stateConflict("资料状态已变化，请刷新后重试");
      const recipients =
        submission.source === "BUTLER"
          ? await transaction.user.findMany({
              where: {
                status: "ACTIVE",
                roles: { some: { expiredAt: null, role: { code: RoleCode.ADMINISTRATOR } } },
              },
              select: { id: true },
            })
          : submission.materialItem.student.defaultButlerId
            ? [{ id: submission.materialItem.student.defaultButlerId }]
            : [];
      for (const recipient of recipients) {
        if (recipient.id === actor.id) continue;
        await this.notifications.createInTransaction(transaction, {
          recipientId: recipient.id,
          eventType: "MATERIAL_SUBMITTED",
          title: `${submission.materialItem.student.name}提交了资料`,
          content: `${submission.materialItem.title}已提交审核，共${files.length}个文件`,
          objectType: "material_submission",
          objectId: submission.id,
          actionUrl: `/workspace/materials?studentId=${submission.materialItem.studentId}`,
          eventKey: `material-submitted:${submission.id}:${recipient.id}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, "material_submission", submission.id, "MATERIAL_SUBMITTED", {
          materialId: submission.materialItemId,
          studentId: submission.materialItem.studentId,
          fileCount: files.length,
          source: submission.source,
          submittedAt: submittedAt.toISOString(),
        }),
      });
    });
    return this.loadSerialized(submission.id, Boolean(expectedStudentId));
  }

  public async withdraw(
    submissionId: string,
    body: WithdrawMaterialSubmissionDto,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const submission = await this.loadAccessible(submissionId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (
      submission.status !== "PENDING_REVIEW" ||
      submission.reviewStartedAt ||
      ![submission.createdById, submission.submittedById].includes(actor.id)
    ) {
      throw this.stateConflict("资料已开始审核或当前用户无权撤回");
    }
    await this.prisma.$transaction(async (transaction) => {
      const changedSubmission = await transaction.materialSubmission.updateMany({
        where: {
          id: submission.id,
          status: "PENDING_REVIEW",
          reviewStartedAt: null,
          OR: [{ createdById: actor.id }, { submittedById: actor.id }],
        },
        data: {
          status: "WITHDRAWN",
          withdrawnAt: new Date(),
          withdrawalReason: body.reason.trim(),
        },
      });
      if (changedSubmission.count !== 1) {
        throw this.stateConflict("资料已开始审核或已由其他操作处理");
      }
      const previous = await transaction.materialSubmission.findFirst({
        where: {
          materialItemId: submission.materialItemId,
          id: { not: submission.id },
          status: { in: ["APPROVED", "NEEDS_CORRECTION", "PENDING_REVIEW", "IN_REVIEW"] },
        },
        orderBy: { submissionNo: "desc" },
      });
      const changedItem = await transaction.materialItem.updateMany({
        where: { id: submission.materialItemId, currentSubmissionId: submission.id },
        data: {
          currentSubmissionId: previous?.id ?? null,
          status: previous ? this.itemStatusForSubmission(previous.status) : "REQUIRED",
          correctionDueAt: previous?.correctionDueAt ?? null,
          version: { increment: 1 },
        },
      });
      if (changedItem.count !== 1) throw this.stateConflict("资料状态已变化，请刷新后重试");
      await transaction.auditLog.create({
        data: this.audit(
          request,
          "material_submission",
          submission.id,
          "MATERIAL_SUBMISSION_WITHDRAWN",
          {
            reason: body.reason.trim(),
            restoredSubmissionId: previous?.id ?? null,
          },
        ),
      });
    });
    return this.loadSerialized(submission.id, Boolean(expectedStudentId));
  }

  public async startReview(submissionId: string, request: RequestContext) {
    const submission = await this.loadAccessible(submissionId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertReviewer(actor, submission);
    if (submission.status !== "PENDING_REVIEW") {
      throw this.stateConflict("该提交当前不在待审核状态");
    }
    await this.prisma.$transaction(async (transaction) => {
      const changedSubmission = await transaction.materialSubmission.updateMany({
        where: { id: submission.id, status: "PENDING_REVIEW", reviewStartedAt: null },
        data: {
          status: "IN_REVIEW",
          reviewStartedById: actor.id,
          reviewStartedAt: new Date(),
        },
      });
      if (changedSubmission.count !== 1) {
        throw this.stateConflict("该提交已由其他审核人开始处理");
      }
      const changedItem = await transaction.materialItem.updateMany({
        where: {
          id: submission.materialItemId,
          currentSubmissionId: submission.id,
          status: "PENDING_REVIEW",
        },
        data: { status: "IN_REVIEW", version: { increment: 1 } },
      });
      if (changedItem.count !== 1) throw this.stateConflict("资料状态已变化，请刷新后重试");
      await transaction.auditLog.create({
        data: this.audit(request, "material_submission", submission.id, "MATERIAL_REVIEW_STARTED", {
          materialId: submission.materialItemId,
        }),
      });
    });
    return this.loadSerialized(submission.id);
  }

  public async review(
    submissionId: string,
    body: ReviewMaterialSubmissionDto,
    request: RequestContext,
  ) {
    const submission = await this.loadAccessible(submissionId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    this.assertReviewer(actor, submission);
    if (submission.status !== "IN_REVIEW" || submission.reviewStartedById !== actor.id) {
      throw this.stateConflict("请先由当前审核人开始审核");
    }
    const pendingFiles = submission.files.filter(
      (file) => !file.removedAt && file.reviewStatus === "PENDING",
    );
    const decisions = new Map(body.fileDecisions.map((decision) => [decision.fileId, decision]));
    const coverageError = materialSubmissionReviewCoverageError({
      pendingFileIds: pendingFiles.map((file) => file.id),
      decisions: body.fileDecisions,
      outcome: body.outcome,
    });
    if (coverageError === "INCOMPLETE_FILE_DECISIONS") {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "必须逐一审核本次新增或替换的全部文件",
      );
    }
    if (coverageError === "OUTCOME_MISMATCH") {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "提交结论必须与逐文件审核结果一致",
      );
    }
    const correctionDueAt =
      body.outcome === "NEEDS_CORRECTION" && body.correctionDueAt
        ? new Date(body.correctionDueAt)
        : null;
    if (correctionDueAt && correctionDueAt.getTime() <= Date.now()) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        "补正截止时间必须晚于当前时间",
      );
    }
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const changedSubmission = await transaction.materialSubmission.updateMany({
        where: {
          id: submission.id,
          status: "IN_REVIEW",
          reviewStartedById: actor.id,
          reviewedAt: null,
        },
        data: {
          status: body.outcome,
          reviewedById: actor.id,
          reviewedAt,
          reviewComment: this.optionalText(body.comment),
          correctionDueAt,
        },
      });
      if (changedSubmission.count !== 1) {
        throw this.stateConflict("该提交已由其他操作完成审核");
      }
      for (const file of pendingFiles) {
        const decision = decisions.get(file.id)!;
        const changedFile = await transaction.materialSubmissionFile.updateMany({
          where: { id: file.id, submissionId: submission.id, reviewStatus: "PENDING" },
          data: {
            reviewStatus: decision.outcome === "APPROVED" ? "APPROVED" : "REJECTED",
            reviewedById: actor.id,
            reviewedAt,
            reviewComment: this.optionalText(decision.comment),
          },
        });
        if (changedFile.count !== 1) throw this.stateConflict("文件审核状态已变化，请刷新后重试");
      }
      const changedItem = await transaction.materialItem.updateMany({
        where: {
          id: submission.materialItemId,
          currentSubmissionId: submission.id,
          status: "IN_REVIEW",
        },
        data: {
          status: body.outcome,
          correctionDueAt,
          missingReason:
            body.outcome === "NEEDS_CORRECTION" ? this.optionalText(body.comment) : null,
          expectedSubmitAt: correctionDueAt,
          version: { increment: 1 },
        },
      });
      if (changedItem.count !== 1) throw this.stateConflict("资料状态已变化，请刷新后重试");
      if (body.outcome === "APPROVED") {
        await this.closeBlockingTask(transaction, submission.materialItemId, "COMPLETED", request);
      }
      const studentRecipient = submission.materialItem.student.portalUserId;
      if (studentRecipient) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: studentRecipient,
          eventType:
            body.outcome === "APPROVED" ? "MATERIAL_REVIEWED" : "MATERIAL_CORRECTION_REQUIRED",
          title:
            body.outcome === "APPROVED"
              ? `${submission.materialItem.title}审核通过`
              : `${submission.materialItem.title}需要补正`,
          content:
            body.outcome === "APPROVED"
              ? "本次提交的资料已通过审核"
              : `${body.comment}${correctionDueAt ? `，请于${correctionDueAt.toLocaleDateString("zh-CN")}前补交` : ""}`,
          objectType: "material_submission",
          objectId: submission.id,
          actionUrl: "/portal/materials",
          eventKey: `material-reviewed:${submission.id}:${body.outcome}:${studentRecipient}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(
          request,
          "material_submission",
          submission.id,
          "MATERIAL_SUBMISSION_REVIEWED",
          {
            materialId: submission.materialItemId,
            outcome: body.outcome,
            comment: body.comment ?? null,
            correctionDueAt: correctionDueAt?.toISOString() ?? null,
            fileDecisions: body.fileDecisions.map((decision) => ({
              fileId: decision.fileId,
              outcome: decision.outcome,
              comment: decision.comment ?? null,
            })),
          },
        ),
      });
    });
    return this.loadSerialized(submission.id);
  }

  public async requestNotApplicable(
    materialId: string,
    body: RequestMaterialNotApplicableDto,
    request: RequestContext,
    expectedStudentId: string,
  ) {
    const item = await this.loadItem(materialId, request, expectedStudentId);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (!canCreateMaterialSubmissionDraft(item.status, false)) {
      throw this.stateConflict("该资料当前不能申请不适用");
    }
    const created = await this.prisma
      .$transaction(async (transaction) => {
        const pending = await transaction.materialApplicabilityRequest.findFirst({
          where: { materialItemId: item.id, status: "PENDING" },
          select: { id: true },
        });
        if (pending) throw this.stateConflict("该资料已有待审核的不适用申请");
        const applicability = await transaction.materialApplicabilityRequest.create({
          data: {
            materialItemId: item.id,
            requestedById: actor.id,
            reason: body.reason.trim(),
          },
        });
        if (item.student.defaultButlerId) {
          await this.notifications.createInTransaction(transaction, {
            recipientId: item.student.defaultButlerId,
            eventType: "MATERIAL_APPLICABILITY_REQUESTED",
            title: `${item.student.name}申请资料不适用`,
            content: `${item.title}：${body.reason.trim()}`,
            objectType: "material_applicability_request",
            objectId: applicability.id,
            actionUrl: `/workspace/materials?studentId=${item.studentId}`,
            eventKey: `material-applicability-requested:${applicability.id}:${item.student.defaultButlerId}`,
          });
        }
        await transaction.auditLog.create({
          data: this.audit(
            request,
            "material_applicability_request",
            applicability.id,
            "MATERIAL_NOT_APPLICABLE_REQUESTED",
            { materialId: item.id, reason: body.reason.trim() },
          ),
        });
        return applicability;
      })
      .catch((error: unknown) => {
        if (this.isPrismaCode(error, "P2002")) {
          throw this.stateConflict("该资料已有待审核的不适用申请");
        }
        throw error;
      });
    return {
      ...created,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  public async reviewApplicability(
    requestId: string,
    body: ReviewMaterialApplicabilityDto,
    request: RequestContext,
  ) {
    const applicability = await this.prisma.materialApplicabilityRequest.findUnique({
      where: { id: requestId },
      include: {
        materialItem: {
          include: {
            student: {
              select: { id: true, name: true, defaultButlerId: true, portalUserId: true },
            },
          },
        },
      },
    });
    if (!applicability) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
        "不适用申请不存在",
      );
    }
    await this.access.assertInternalAccess(applicability.materialItem.studentId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (
      !actor.roles.includes(RoleCode.ADMINISTRATOR) &&
      (!actor.roles.includes(RoleCode.BUTLER) ||
        applicability.materialItem.student.defaultButlerId !== actor.id)
    ) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权审核该不适用申请");
    }
    if (applicability.status !== "PENDING") throw this.stateConflict("该申请已处理");
    const reviewedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const changedRequest = await transaction.materialApplicabilityRequest.updateMany({
        where: { id: applicability.id, status: "PENDING" },
        data: {
          status: body.outcome,
          reviewedById: actor.id,
          reviewedAt,
          reviewComment: this.optionalText(body.comment),
        },
      });
      if (changedRequest.count !== 1) throw this.stateConflict("该申请已由其他操作处理");
      if (body.outcome === "APPROVED") {
        const changed = await transaction.materialItem.updateMany({
          where: {
            id: applicability.materialItemId,
            status: {
              in: [
                "REQUIRED",
                "PARTIALLY_MISSING",
                "RESUBMISSION_REQUIRED",
                "AWAITING_CONFIRMATION",
                "NEEDS_CORRECTION",
              ],
            },
          },
          data: {
            status: "NOT_APPLICABLE",
            missingReason: applicability.reason,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          throw this.stateConflict("资料状态已变化，请刷新后重新处理");
        }
        await this.closeBlockingTask(
          transaction,
          applicability.materialItemId,
          "NOT_APPLICABLE",
          request,
        );
      }
      const recipientId = applicability.materialItem.student.portalUserId;
      if (recipientId) {
        await this.notifications.createInTransaction(transaction, {
          recipientId,
          eventType: "MATERIAL_APPLICABILITY_REVIEWED",
          title: `${applicability.materialItem.title}不适用申请已处理`,
          content: body.outcome === "APPROVED" ? "申请已通过" : `申请未通过：${body.comment}`,
          objectType: "material_applicability_request",
          objectId: applicability.id,
          actionUrl: "/portal/materials",
          eventKey: `material-applicability-reviewed:${applicability.id}:${body.outcome}:${recipientId}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(
          request,
          "material_applicability_request",
          applicability.id,
          "MATERIAL_NOT_APPLICABLE_REVIEWED",
          { outcome: body.outcome, comment: body.comment ?? null },
        ),
      });
    });
    return { id: applicability.id, status: body.outcome, reviewedAt: reviewedAt.toISOString() };
  }

  public async cancelSpecial(
    materialId: string,
    body: CancelSpecialMaterialDto,
    request: RequestContext,
  ) {
    const item = await this.loadItem(materialId, request);
    const actor = request.authenticatedUser as AuthenticatedUser;
    if (item.origin !== "SPECIAL") throw this.stateConflict("标准资料不能取消，请使用不适用流程");
    if (
      !actor.roles.includes(RoleCode.ADMINISTRATOR) &&
      (!actor.roles.includes(RoleCode.BUTLER) || item.student.defaultButlerId !== actor.id)
    ) {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权取消该特殊资料");
    }
    if (item.version !== body.version) throw this.versionConflict(item.version);
    if (["DRAFT", "PENDING_REVIEW", "IN_REVIEW"].includes(item.status)) {
      throw this.stateConflict("请先结束当前草稿或审核流程再取消该资料");
    }
    if (["CANCELED", "NOT_APPLICABLE"].includes(item.status)) {
      throw this.stateConflict("该资料已取消或不适用");
    }
    await this.prisma.$transaction(async (transaction) => {
      const changedItem = await transaction.materialItem.updateMany({
        where: {
          id: item.id,
          version: body.version,
          status: { notIn: ["DRAFT", "PENDING_REVIEW", "IN_REVIEW", "CANCELED", "NOT_APPLICABLE"] },
        },
        data: {
          status: "CANCELED",
          canceledAt: new Date(),
          canceledById: actor.id,
          cancelReason: body.reason.trim(),
          version: { increment: 1 },
        },
      });
      if (changedItem.count !== 1) throw this.stateConflict("资料状态已变化，请刷新后重试");
      await this.closeBlockingTask(transaction, item.id, "NOT_APPLICABLE", request);
      if (item.student.portalUserId) {
        await this.notifications.createInTransaction(transaction, {
          recipientId: item.student.portalUserId,
          eventType: "MATERIAL_REVIEWED",
          title: `${item.title}已取消`,
          content: body.reason.trim(),
          objectType: "material",
          objectId: item.id,
          actionUrl: "/portal/materials",
          eventKey: `material-canceled:${item.id}:${body.version}:${item.student.portalUserId}`,
        });
      }
      await transaction.auditLog.create({
        data: this.audit(request, "material", item.id, "SPECIAL_MATERIAL_CANCELED", {
          reason: body.reason.trim(),
        }),
      });
    });
    return { id: item.id, status: "CANCELED" as const, version: item.version + 1 };
  }

  public async downloadFile(fileId: string, request: RequestContext, expectedStudentId?: string) {
    const file = await this.prisma.materialSubmissionFile.findUnique({
      where: { id: fileId },
      include: {
        submission: {
          include: {
            materialItem: { include: { student: true, materialType: true } },
          },
        },
      },
    });
    if (
      !file ||
      file.removedAt ||
      (expectedStudentId && file.submission.materialItem.studentId !== expectedStudentId)
    ) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "资料文件不存在");
    }
    if (!expectedStudentId) {
      await this.access.assertInternalAccess(file.submission.materialItem.studentId, request);
      const actor = request.authenticatedUser as AuthenticatedUser;
      if (
        actor.roles.includes(RoleCode.PLANNER) &&
        (file.submission.status !== "APPROVED" ||
          !PLANNER_VISIBLE_MATERIAL_CODES.includes(file.submission.materialItem.materialType.code))
      ) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          ErrorCode.FORBIDDEN,
          "规划老师只能查看职责范围内已通过的资料",
        );
      }
    }
    await this.prisma.auditLog.create({
      data: this.audit(request, "material_submission_file", file.id, "MATERIAL_FILE_DOWNLOADED", {
        submissionId: file.submissionId,
        materialId: file.submission.materialItemId,
        fileName: file.fileName,
      }),
    });
    return {
      buffer: await this.storage.read(file.storageKey),
      fileName: file.fileName,
      mimeType: file.mimeType,
    };
  }

  private async loadItem(materialId: string, request: RequestContext, expectedStudentId?: string) {
    const item = await this.prisma.materialItem.findUnique({
      where: { id: materialId },
      include: {
        student: {
          select: {
            id: true,
            name: true,
            defaultButlerId: true,
            plannerId: true,
            portalUserId: true,
          },
        },
        currentSubmission: {
          include: { files: true },
        },
        applicabilityRequests: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
    });
    if (!item || (expectedStudentId && item.studentId !== expectedStudentId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "资料项不存在");
    }
    if (!expectedStudentId) await this.access.assertInternalAccess(item.studentId, request);
    return item;
  }

  private async loadAccessible(
    submissionId: string,
    request: RequestContext,
    expectedStudentId?: string,
  ) {
    const submission = await this.prisma.materialSubmission.findUnique({
      where: { id: submissionId },
      include: SUBMISSION_INCLUDE,
    });
    if (
      !submission ||
      (expectedStudentId && submission.materialItem.studentId !== expectedStudentId)
    ) {
      throw new ApiException(HttpStatus.NOT_FOUND, ErrorCode.RESOURCE_NOT_FOUND, "资料提交不存在");
    }
    if (!expectedStudentId) {
      await this.access.assertInternalAccess(submission.materialItem.studentId, request);
    }
    return submission;
  }

  private async loadSerialized(submissionId: string, portalView = false) {
    const submission = await this.prisma.materialSubmission.findUniqueOrThrow({
      where: { id: submissionId },
      include: SUBMISSION_INCLUDE,
    });
    return this.serializeSubmission(submission, portalView);
  }

  private serializeSubmission(submission: SubmissionWithContent, portalView = false) {
    return {
      id: submission.id,
      materialItemId: submission.materialItemId,
      submissionNo: submission.submissionNo,
      status: submission.status,
      source: submission.source,
      createdBy: submission.createdBy,
      submittedBy: submission.submittedBy,
      submissionReason: submission.submissionReason,
      submittedAt: submission.submittedAt?.toISOString() ?? null,
      withdrawnAt: submission.withdrawnAt?.toISOString() ?? null,
      withdrawalReason: submission.withdrawalReason,
      reviewStartedBy: submission.reviewStartedBy,
      reviewStartedAt: submission.reviewStartedAt?.toISOString() ?? null,
      reviewedBy: submission.reviewedBy,
      reviewedAt: submission.reviewedAt?.toISOString() ?? null,
      reviewComment: submission.reviewComment,
      correctionDueAt: submission.correctionDueAt?.toISOString() ?? null,
      files: submission.files.map((file) => this.serializeFile(file, portalView)),
      createdAt: submission.createdAt.toISOString(),
      updatedAt: submission.updatedAt.toISOString(),
    };
  }

  private serializeFile(
    file: {
      id: string;
      submissionId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
      fileHash: string;
      uploadedAt: Date;
      reviewStatus: string;
      reviewedAt: Date | null;
      reviewComment: string | null;
      copiedFromFileId: string | null;
      removedAt: Date | null;
      removalReason: string | null;
    },
    portalView = false,
  ) {
    return {
      id: file.id,
      submissionId: file.submissionId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      fileSize: file.fileSize,
      fileHash: file.fileHash,
      uploadedAt: file.uploadedAt.toISOString(),
      reviewStatus: file.reviewStatus,
      reviewedAt: file.reviewedAt?.toISOString() ?? null,
      reviewComment: file.reviewComment,
      copiedFromFileId: file.copiedFromFileId,
      removedAt: file.removedAt?.toISOString() ?? null,
      removalReason: file.removalReason,
      downloadUrl: portalView
        ? `/api/v1/portal/me/material-submission-files/${file.id}/download`
        : `/api/v1/material-submission-files/${file.id}/download`,
      previewUrl: this.isPreviewable(file.mimeType)
        ? portalView
          ? `/api/v1/portal/me/material-submission-files/${file.id}/download?preview=true`
          : `/api/v1/material-submission-files/${file.id}/download?preview=true`
        : null,
    };
  }

  private assertDraftOwner(submission: SubmissionWithContent, actorId: string) {
    if (submission.status !== "DRAFT" || submission.createdById !== actorId) {
      throw this.stateConflict("只有草稿创建人可以修改或提交文件");
    }
  }

  private assertReviewer(actor: AuthenticatedUser, submission: SubmissionWithContent) {
    const isAdministrator = actor.roles.includes(RoleCode.ADMINISTRATOR);
    const isResponsibleButler =
      actor.roles.includes(RoleCode.BUTLER) &&
      submission.materialItem.student.defaultButlerId === actor.id;
    const access = materialSubmissionReviewAccess({
      isAdministrator,
      isResponsibleButler,
      isUploader: submission.createdById === actor.id || submission.submittedById === actor.id,
      source: submission.source,
    });
    if (access === "NOT_RESPONSIBLE_REVIEWER") {
      throw new ApiException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, "无权审核该资料");
    }
    if (access === "SELF_REVIEW") {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "上传人不能审核自己的资料提交",
      );
    }
    if (access === "ADMIN_REVIEW_REQUIRED") {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        "管家代传资料必须由管理员审核",
      );
    }
  }

  private decodeAndValidateFile(body: UploadMaterialVersionDto) {
    const extension = path.extname(body.fileName).toLowerCase();
    if (!ALLOWED_FILES[extension]?.includes(body.mimeType)) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        "仅支持PDF、DOC、DOCX、JPG、JPEG和PNG文件",
      );
    }
    const content = Buffer.from(body.contentBase64, "base64");
    if (content.length === 0 || content.length > this.maxUploadBytes) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.MATERIAL_FILE_INVALID,
        `文件不能为空且不得超过${Math.floor(this.maxUploadBytes / 1024 / 1024)}MB`,
      );
    }
    return content;
  }

  private itemStatusForSubmission(status: string) {
    if (status === "APPROVED") return "APPROVED" as const;
    if (status === "NEEDS_CORRECTION") return "NEEDS_CORRECTION" as const;
    if (status === "IN_REVIEW") return "IN_REVIEW" as const;
    return "PENDING_REVIEW" as const;
  }

  private async closeBlockingTask(
    transaction: Prisma.TransactionClient,
    materialId: string,
    status: Extract<TaskStatus, "COMPLETED" | "NOT_APPLICABLE">,
    request: RequestContext,
  ) {
    const task = await transaction.taskInstance.findFirst({
      where: {
        sourceType: "MATERIAL",
        sourceObjectId: materialId,
        status: { in: ["TODO", "IN_PROGRESS"] },
      },
    });
    if (!task) return;
    const actor = request.authenticatedUser as AuthenticatedUser;
    await transaction.taskInstance.update({
      where: { id: task.id },
      data: {
        status,
        completedAt: status === "COMPLETED" ? new Date() : null,
        completionNote:
          status === "COMPLETED" ? "关联资料提交已审核通过" : "关联资料已审核为不适用",
        version: { increment: 1 },
      },
    });
    await transaction.taskTimelineEvent.create({
      data: {
        taskId: task.id,
        eventType: status === "COMPLETED" ? "COMPLETED" : "MARKED_NOT_APPLICABLE",
        actorId: actor.id,
        actorRole: actor.roles[0] ?? null,
        summary: status === "COMPLETED" ? "资料审核通过" : "资料不适用申请审核通过",
      },
    });
    await this.progress.advanceAfterTaskTerminal(
      transaction,
      task.id,
      status === "COMPLETED" ? "TASK_COMPLETED" : "TASK_NOT_APPLICABLE",
      request,
    );
  }

  private stateConflict(message: string) {
    return new ApiException(HttpStatus.CONFLICT, ErrorCode.MATERIAL_REVIEW_CONFLICT, message);
  }

  private versionConflict(currentVersion: number) {
    return new ApiException(
      HttpStatus.CONFLICT,
      ErrorCode.MATERIAL_VERSION_CONFLICT,
      "资料已被其他操作更新，请刷新后重试",
      { currentVersion },
    );
  }

  private optionalText(value: string | null | undefined) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  private isPrismaCode(error: unknown, code: string) {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === code
    );
  }

  private isPreviewable(mimeType: string) {
    return mimeType === "application/pdf" || mimeType.startsWith("image/");
  }

  private audit(
    request: RequestContext,
    objectType: string,
    objectId: string,
    action: string,
    afterData: Prisma.InputJsonObject,
  ): Prisma.AuditLogUncheckedCreateInput {
    const actor = request.authenticatedUser as AuthenticatedUser;
    return {
      operatorId: actor.id,
      operatorRole: actor.roles[0] ?? null,
      objectType,
      objectId,
      action,
      afterData,
      requestId: request.requestId,
      ipAddress: request.ip,
      deviceInfo: request.header("User-Agent"),
    };
  }
}
