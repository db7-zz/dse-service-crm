import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnvironment } from "dotenv";
import argon2 from "argon2";
import { createPrismaClient } from "./src/index.js";

loadEnvironment({
  path: new URL("../.env", import.meta.url),
  quiet: true,
});

const ROLE_DEFINITIONS = [
  ["ADMINISTRATOR", "管理员", "维护账号、角色、权限、审计和全部V1.0业务"],
  ["ERIC_MANAGER", "历史业务负责人", "仅为历史审计保留，不再用于新账号分配"],
  ["BUTLER", "管家", "负责学生日常服务协调"],
  ["PLANNER", "规划老师", "负责学情与升学规划"],
  ["SPECIALIST", "专项老师", "执行被分配的专项任务"],
  ["STUDENT", "学生", "访问本人对外服务入口"],
] as const;

const PERMISSION_DEFINITIONS = [
  ["workspace.access", "访问内部工作区"],
  ["supervision.access", "访问监督管理端"],
  ["system.users.read", "查看账号"],
  ["system.users.write", "维护账号"],
  ["system.audit.read", "查看审计日志"],
  ["portal.access", "访问学生入口"],
  ["students.read", "查看学生最小档案"],
  ["students.own.read", "查看本人负责学生的服务进度"],
  ["students.write", "维护学生最小档案与负责人"],
  ["students.own.write", "管家接手、开通并确认本人学生档案"],
  ["student-handoffs.read", "查看签约学生交接"],
  ["student-handoffs.write", "创建签约学生交接"],
  ["sop.read", "查看SOP版本"],
  ["sop.write", "维护和发布SOP版本"],
  ["service.activation.write", "启用学生服务并套用SOP"],
  ["tasks.own.read", "查看本人负责的任务"],
  ["tasks.own.write", "执行本人负责的任务"],
  ["tasks.supervision.read", "查看全部任务与监督数据"],
  ["tasks.supervision.write", "改期、转派和取消任务"],
  ["overdue-alerts.read", "查看逾期提醒"],
  ["overdue-alerts.write", "处理逾期提醒"],
  ["students.planning.write", "维护学生学情与升学目标"],
  ["materials.read", "查看资料"],
  ["materials.write", "维护资料"],
  ["materials.review", "审核资料"],
  ["applications.read", "查看申请"],
  ["applications.write", "维护申请"],
  ["issues.read", "查看问题反馈"],
  ["issues.write", "提交与补充问题"],
  ["issues.manage", "处理问题与专项任务"],
  ["notifications.read", "查看站内通知"],
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMINISTRATOR: [
    "workspace.access",
    "system.users.read",
    "system.users.write",
    "system.audit.read",
    "students.read",
    "students.write",
    "student-handoffs.read",
    "student-handoffs.write",
    "sop.read",
    "sop.write",
    "service.activation.write",
    "tasks.supervision.read",
    "tasks.supervision.write",
    "overdue-alerts.read",
    "overdue-alerts.write",
    "students.planning.write",
    "materials.read",
    "materials.review",
    "applications.read",
    "applications.write",
    "issues.read",
    "issues.write",
    "issues.manage",
    "notifications.read",
  ],
  ERIC_MANAGER: [],
  BUTLER: [
    "workspace.access",
    "students.own.read",
    "students.own.write",
    "student-handoffs.read",
    "tasks.own.read",
    "tasks.own.write",
    "materials.read",
    "materials.write",
    "materials.review",
    "applications.read",
    "applications.write",
    "issues.read",
    "issues.write",
    "notifications.read",
  ],
  PLANNER: [
    "workspace.access",
    "students.own.read",
    "students.planning.write",
    "materials.read",
    "applications.read",
    "notifications.read",
  ],
  SPECIALIST: [
    "workspace.access",
    "tasks.own.read",
    "tasks.own.write",
    "issues.read",
    "notifications.read",
  ],
  STUDENT: ["portal.access", "notifications.read"],
};

const MATERIAL_TYPES = [
  [
    "BASIC_INFORMATION",
    "基本信息表",
    "由学生或家长在线填写，管家确认后写入正式档案",
    true,
    "FORM",
    "CURRENT",
    1,
  ],
  ["SELF_RECOMMENDATION", "自荐信素材", "学生填写的自荐信及文书素材", true, "FILE", "CURRENT", 2],
  [
    "TRANSCRIPT",
    "高中三年成绩单",
    "成绩单需包含年级排名；当前阶段可暂缓",
    true,
    "FILE",
    "LATER",
    3,
  ],
  ["ENROLLMENT_PROOF", "在读证明", "由学校开具；当前阶段可暂缓", true, "FILE", "LATER", 4],
  ["RECOMMENDATION", "推荐信素材", "学生填写或上传推荐信相关素材", false, "FILE", "CURRENT", 5],
  [
    "IDENTITY",
    "身份证明",
    "按实际情况上传身份证、护照或港澳通行证彩色正反面扫描件",
    true,
    "FILE",
    "CURRENT",
    6,
  ],
  ["PROFILE_PHOTO", "近照免冠照电子版", "1张白底或蓝底免冠证件照", true, "FILE", "CURRENT", 7],
  [
    "ACTIVITY_EVIDENCE",
    "社会实践及获奖证明",
    "高中阶段活动、比赛、奖项证明及活动照片",
    false,
    "FILE",
    "CURRENT",
    8,
  ],
  ["PREDICTED_GRADES", "预估及正式成绩单", "由学校开具；当前阶段可暂缓", true, "FILE", "LATER", 9],
  [
    "EXAM_CHECKLIST",
    "CHECKLIST及准考证",
    "收到后再上传；当前阶段可暂缓",
    false,
    "FILE",
    "LATER",
    10,
  ],
  ["RESUME", "简历（如有）", "如已有简历可上传，没有可标记不适用", false, "FILE", "CURRENT", 11],
  [
    "HKEAA_ACCOUNT",
    "考评局系统账号（如有）",
    "敏感凭证不作为普通文件或备注保存，请通过安全渠道提供",
    false,
    "SECURE_REFERENCE",
    "LATER",
    12,
  ],
  [
    "JUPAS_ACCOUNT",
    "JUPAS系统账号（如有）",
    "敏感凭证不作为普通文件或备注保存，请通过安全渠道提供",
    false,
    "SECURE_REFERENCE",
    "LATER",
    13,
  ],
  [
    "LANGUAGE_SCORE",
    "雅思或托福成绩（如有）",
    "如有雅思或托福成绩请上传，没有可标记不适用",
    false,
    "FILE",
    "CURRENT",
    14,
  ],
] as const;

const SOP_BASELINE_STAGES = [
  ["PROFILE", "建档阶段"],
  ["ASSESSMENT", "学情评估阶段"],
  ["PLANNING", "升学规划阶段"],
  ["MATERIALS", "资料准备阶段"],
  ["ESSAYS", "文书准备阶段"],
  ["SUBMISSION", "申请递交阶段"],
  ["RESULTS", "申请结果跟进阶段"],
  ["ENROLLMENT", "入学确认阶段"],
] as const;

const SOP_BASELINE_TASKS: Record<
  (typeof SOP_BASELINE_STAGES)[number][0],
  {
    name: string;
    completionCriteria: string;
    completionWindowHours: number;
  }
> = {
  PROFILE: {
    name: "确认学生建档资料",
    completionCriteria: "核对学生联系方式与服务负责人信息，记录缺失项",
    completionWindowHours: 24,
  },
  ASSESSMENT: {
    name: "完成学情访谈与记录",
    completionCriteria: "完成首次学情访谈并形成可追溯的访谈记录",
    completionWindowHours: 48,
  },
  PLANNING: {
    name: "确认升学规划要点",
    completionCriteria: "与学生确认规划方向、关键选择和后续行动项",
    completionWindowHours: 72,
  },
  MATERIALS: {
    name: "建立申请材料清单",
    completionCriteria: "列明全部所需材料、当前状态和责任人",
    completionWindowHours: 96,
  },
  ESSAYS: {
    name: "推进首轮文书准备",
    completionCriteria: "完成文书素材收集并确认首轮交付安排",
    completionWindowHours: 168,
  },
  SUBMISSION: {
    name: "核对申请递交准备",
    completionCriteria: "完成递交前资料核对并记录待处理风险",
    completionWindowHours: 240,
  },
  RESULTS: {
    name: "建立申请结果跟进",
    completionCriteria: "确认结果查询方式、跟进频率和异常升级路径",
    completionWindowHours: 720,
  },
  ENROLLMENT: {
    name: "确认入学安排",
    completionCriteria: "核对录取确认、注册、缴费及入学前关键事项",
    completionWindowHours: 1440,
  },
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required seed variable: ${name}`);
  }
  return value;
}

const DEVELOPMENT_DATA_TABLES = [
  "rectification_items",
  "rectification_records",
  "task_evidence",
  "student_confirmations",
  "notifications",
  "issue_logs",
  "issues",
  "application_requirements",
  "application_status_logs",
  "applications",
  "material_followups",
  "material_versions",
  "material_items",
  "student_targets",
  "student_scores",
  "task_operation_receipts",
  "task_timeline_events",
  "overdue_alerts",
  "task_reassignments",
  "task_due_date_changes",
  "task_extension_reports",
  "task_progress_records",
  "stage_transitions",
  "service_progress_calculation_runs",
  "task_instances",
  "stage_instances",
  "student_service_activations",
  "student_profile_submissions",
  "signed_student_handoffs",
  "sop_task_templates",
  "sop_stage_templates",
  "sop_versions",
  "student_responsibility_changes",
  "students",
  "audit_logs",
  "sessions",
  "role_permissions",
  "user_roles",
  "users",
  "permissions",
  "roles",
  "material_types",
] as const;

function assertSafeDevelopmentDatabaseUrl(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")).toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(parsed.hostname) || !/(?:^|[_-])dev(?:$|[_-])/.test(databaseName)) {
    throw new Error(
      `Development seed reset refused: expected a local database whose name contains dev; received ${parsed.hostname}/${databaseName || "unknown"}.`,
    );
  }
}

function shiftDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

async function storeDemoPdf(storageKey: string, title: string) {
  const apiRoot = fileURLToPath(new URL("../apps/api/", import.meta.url));
  const storageRoot = path.resolve(apiRoot, process.env.FILE_STORAGE_ROOT ?? "./tmp/uploads");
  const fullPath = path.resolve(storageRoot, storageKey.replaceAll("/", path.sep));
  const storagePrefix = `${storageRoot}${path.sep}`;
  if (!fullPath.startsWith(storagePrefix)) {
    throw new Error("Demo file storage key resolved outside FILE_STORAGE_ROOT.");
  }
  const content = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n4 0 obj<</Length 44>>stream\nBT /F1 12 Tf 72 720 Td (${title}) Tj ET\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`,
    "utf8",
  );
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
  return {
    fileSize: content.length,
    fileHash: createHash("sha256").update(content).digest("hex"),
  };
}

async function main(): Promise<void> {
  const environment = process.env.NODE_ENV ?? "development";
  if (environment === "staging" || environment === "production") {
    throw new Error("The development seed is disabled in staging and production.");
  }

  const databaseUrl = required("DATABASE_URL");
  assertSafeDevelopmentDatabaseUrl(databaseUrl);
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? required("SEED_ADMIN_PASSWORD");
  if (demoPassword.length < 6) {
    throw new Error("The demo account password must contain at least 6 characters.");
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${DEVELOPMENT_DATA_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );

    for (const [code, name, description] of ROLE_DEFINITIONS) {
      await prisma.role.create({ data: { code, name, description } });
    }

    for (const [code, name] of PERMISSION_DEFINITIONS) {
      await prisma.permission.create({ data: { code, name } });
    }

    for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
      const permissions = await prisma.permission.findMany({
        where: { code: { in: permissionCodes } },
      });
      if (permissions.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
    }

    const accounts = [
      {
        username: "admin",
        displayName: "演示管理员",
        roleCode: "ADMINISTRATOR",
      },
      {
        username: "butler",
        displayName: "演示管家",
        roleCode: "BUTLER",
      },
      {
        username: "planner",
        displayName: "演示规划老师",
        roleCode: "PLANNER",
      },
      {
        username: "student",
        displayName: "陈乐怡",
        roleCode: "STUDENT",
      },
    ] as const;

    const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id });
    const users = new Map<string, Awaited<ReturnType<typeof prisma.user.create>>>();
    for (const account of accounts) {
      const user = await prisma.user.create({
        data: {
          username: account.username,
          displayName: account.displayName,
          passwordHash,
          status: "ACTIVE",
        },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { code: account.roleCode } });
      await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
      users.set(account.username, user);
    }

    for (const [
      code,
      name,
      description,
      isCore,
      inputMode,
      collectionPhase,
      sequenceNo,
    ] of MATERIAL_TYPES) {
      await prisma.materialType.create({
        data: {
          code,
          name,
          description,
          isCore,
          isActive: true,
          inputMode,
          collectionPhase,
          sequenceNo,
        },
      });
    }

    const administrator = users.get("admin")!;
    const butler = users.get("butler")!;
    const planner = users.get("planner")!;
    const portalUser = users.get("student")!;
    const now = new Date();
    const enabledAt = shiftDays(now, -14);

    const sop = await prisma.sopVersion.create({
      data: {
        versionNo: 1,
        status: "PUBLISHED",
        publishedAt: shiftDays(enabledAt, -1),
        createdById: administrator.id,
        stages: {
          create: SOP_BASELINE_STAGES.map(([stageCode, name], index) => ({
            stageCode,
            name,
            sequenceNo: index + 1,
            description: `演示服务流程第 ${index + 1} 阶段`,
            tasks: {
              create: {
                ...SOP_BASELINE_TASKS[stageCode],
                sequenceNo: 1,
                ownerRole: "BUTLER",
                isBlocking: true,
              },
            },
            materials:
              stageCode === "MATERIALS"
                ? {
                    create: MATERIAL_TYPES.map(
                      ([code, materialName, description, isCore, , , sequenceNo]) => ({
                        materialType: { connect: { code } },
                        title: materialName,
                        requirement: description,
                        requirementKind: isCore ? ("REQUIRED" as const) : ("OPTIONAL" as const),
                        deadlineRule: "ACTIVATION_OFFSET" as const,
                        deadlineOffsetDays: sequenceNo + 2,
                        sequenceNo,
                      }),
                    ),
                  }
                : undefined,
          })),
        },
      },
      include: {
        stages: {
          include: { tasks: true, materials: { include: { materialType: true } } },
          orderBy: { sequenceNo: "asc" },
        },
      },
    });

    const student = await prisma.student.create({
      data: {
        studentNo: "DSE-2026-0001",
        name: "陈乐怡",
        englishName: "Joyce Chan",
        school: "港岛示范中学",
        grade: "中六",
        cohortYear: 2026,
        phone: "90000001",
        email: "student@example.test",
        portalUserId: portalUser.id,
        defaultButlerId: butler.id,
        plannerId: planner.id,
        serviceStatus: "ENABLED",
        nextMilestone: "确认首轮选校与 JUPAS 课程排序，并补交预测成绩",
        riskLevel: "ATTENTION",
        riskNote: "首轮选校确认已延期，预测成绩仍待补交。",
        version: 2,
        createdById: administrator.id,
      },
    });

    await prisma.studentResponsibilityChange.create({
      data: {
        studentId: student.id,
        responsibilityType: "DEFAULT_BUTLER",
        newUserId: butler.id,
        reason: "管理员完成新生建档并分配默认管家",
        operatorId: administrator.id,
        createdAt: enabledAt,
      },
    });

    await prisma.studentResponsibilityChange.create({
      data: {
        studentId: student.id,
        responsibilityType: "PLANNER",
        newUserId: planner.id,
        reason: "管理员完成新生建档并分配规划老师",
        operatorId: administrator.id,
        createdAt: enabledAt,
      },
    });

    const activation = await prisma.studentServiceActivation.create({
      data: {
        studentId: student.id,
        sopVersionId: sop.id,
        enabledById: administrator.id,
        enabledAt,
      },
    });

    const stageInstances = new Map<string, { id: string }>();
    for (const stage of sop.stages) {
      const completed = stage.sequenceNo <= 2;
      const current = stage.stageCode === "PLANNING";
      const instance = await prisma.stageInstance.create({
        data: {
          studentId: student.id,
          serviceActivationId: activation.id,
          sopVersionId: sop.id,
          stageTemplateId: stage.id,
          stageCodeSnapshot: stage.stageCode,
          nameSnapshot: stage.name,
          sequenceNoSnapshot: stage.sequenceNo,
          descriptionSnapshot: stage.description,
          status: completed ? "COMPLETED" : current ? "IN_PROGRESS" : "NOT_STARTED",
          startedAt: completed || current ? shiftDays(enabledAt, (stage.sequenceNo - 1) * 3) : null,
          completedAt: completed ? shiftDays(enabledAt, stage.sequenceNo * 3 - 1) : null,
          completionReason: completed ? "阶段标准任务已完成" : null,
          version: completed ? 2 : current ? 1 : 0,
        },
      });
      stageInstances.set(stage.stageCode, instance);
    }

    const stageTasks = new Map<string, { id: string }>();
    for (const stage of sop.stages) {
      const template = stage.tasks[0]!;
      const completed = stage.sequenceNo <= 2;
      const current = stage.stageCode === "PLANNING";
      const dueAt = completed
        ? shiftDays(enabledAt, stage.sequenceNo * 3)
        : shiftDays(now, stage.sequenceNo === 3 ? 2 : stage.sequenceNo * 4);
      const task = await prisma.taskInstance.create({
        data: {
          studentId: student.id,
          serviceActivationId: activation.id,
          stageInstanceId: stageInstances.get(stage.stageCode)!.id,
          taskTemplateId: template.id,
          sopVersionId: sop.id,
          sourceType: "SOP",
          isBlockingSnapshot: true,
          evidenceRequiredSnapshot: stage.stageCode === "PROFILE",
          externalVisible: stage.sequenceNo >= 3 && stage.sequenceNo <= 4,
          titleSnapshot: template.name,
          descriptionSnapshot: template.description,
          completionCriteriaSnapshot: template.completionCriteria,
          completionWindowHoursSnapshot: template.completionWindowHours,
          ownerId: butler.id,
          status: completed ? "COMPLETED" : current ? "IN_PROGRESS" : "TODO",
          progressPercent: completed ? 100 : current ? 60 : 0,
          originalDueAt: dueAt,
          currentDueAt: dueAt,
          startedAt: completed || current ? shiftDays(dueAt, -2) : null,
          completedAt: completed ? shiftDays(dueAt, -1) : null,
          completionNote: completed ? "管家已完成并记录结果，学生可在门户查看阶段进度。" : null,
        },
      });
      stageTasks.set(stage.stageCode, task);
      await prisma.taskTimelineEvent.createMany({
        data: [
          {
            taskId: task.id,
            eventType: "CREATED",
            actorId: administrator.id,
            actorRole: "ADMINISTRATOR",
            summary: "管理员启用服务，系统按 SOP 生成任务",
            createdAt: enabledAt,
          },
          {
            taskId: task.id,
            eventType: "ASSIGNED",
            actorId: administrator.id,
            actorRole: "ADMINISTRATOR",
            summary: "任务分配给学生默认管家",
            afterData: { ownerId: butler.id },
            createdAt: enabledAt,
          },
          ...(completed || current
            ? [
                {
                  taskId: task.id,
                  eventType: "STARTED" as const,
                  actorId: butler.id,
                  actorRole: "BUTLER",
                  summary: "管家开始执行任务",
                  createdAt: shiftDays(dueAt, -2),
                },
              ]
            : []),
          ...(completed
            ? [
                {
                  taskId: task.id,
                  eventType: "COMPLETED" as const,
                  actorId: butler.id,
                  actorRole: "BUTLER",
                  summary: "管家完成任务并提交结果",
                  createdAt: shiftDays(dueAt, -1),
                },
              ]
            : []),
        ],
      });
      if (completed || current) {
        await prisma.taskProgressRecord.create({
          data: {
            taskId: task.id,
            progressNote: completed
              ? "已与学生核对信息并完成阶段交付。"
              : "已完成方向访谈和首轮院校筛选，等待学生确认课程排序。",
            progressPercent: completed ? 90 : 60,
            createdById: butler.id,
            createdAt: completed ? shiftDays(dueAt, -1) : shiftDays(now, -1),
          },
        });
      }
    }

    const profileStage = stageInstances.get("PROFILE")!;
    const assessmentStage = stageInstances.get("ASSESSMENT")!;
    const planningStage = stageInstances.get("PLANNING")!;
    await prisma.stageTransition.createMany({
      data: [
        {
          stageInstanceId: profileStage.id,
          fromStatus: null,
          toStatus: "IN_PROGRESS",
          triggerType: "SERVICE_ACTIVATION",
          summary: "服务启用，进入建档阶段",
          deduplicationKey: `${profileStage.id}:activation`,
          createdAt: enabledAt,
        },
        {
          stageInstanceId: profileStage.id,
          fromStatus: "IN_PROGRESS",
          toStatus: "COMPLETED",
          triggerType: "TASK_COMPLETED",
          triggerTaskId: stageTasks.get("PROFILE")!.id,
          summary: "建档任务完成，建档阶段完成",
          deduplicationKey: `${profileStage.id}:completed`,
          createdAt: shiftDays(enabledAt, 2),
        },
        {
          stageInstanceId: assessmentStage.id,
          fromStatus: "NOT_STARTED",
          toStatus: "IN_PROGRESS",
          triggerType: "CONTINUOUS_ADVANCE",
          summary: "进入学情评估阶段",
          deduplicationKey: `${assessmentStage.id}:started`,
          createdAt: shiftDays(enabledAt, 2),
        },
        {
          stageInstanceId: assessmentStage.id,
          fromStatus: "IN_PROGRESS",
          toStatus: "COMPLETED",
          triggerType: "TASK_COMPLETED",
          triggerTaskId: stageTasks.get("ASSESSMENT")!.id,
          summary: "学情评估任务完成，阶段完成",
          deduplicationKey: `${assessmentStage.id}:completed`,
          createdAt: shiftDays(enabledAt, 5),
        },
        {
          stageInstanceId: planningStage.id,
          fromStatus: "NOT_STARTED",
          toStatus: "IN_PROGRESS",
          triggerType: "CONTINUOUS_ADVANCE",
          summary: "进入升学规划阶段",
          deduplicationKey: `${planningStage.id}:started`,
          createdAt: shiftDays(enabledAt, 5),
        },
      ],
    });

    await prisma.studentServiceActivation.update({
      where: { id: activation.id },
      data: {
        currentStageInstanceId: planningStage.id,
        completedStageCount: 2,
        progressVersion: 3,
        lastCalculatedAt: now,
      },
    });

    const overdueTask = await prisma.taskInstance.create({
      data: {
        studentId: student.id,
        serviceActivationId: activation.id,
        stageInstanceId: planningStage.id,
        sopVersionId: sop.id,
        sourceType: "MANUAL",
        isBlockingSnapshot: true,
        externalVisible: true,
        createdById: administrator.id,
        titleSnapshot: "确认首轮选校与课程排序",
        descriptionSnapshot: "管家整理首轮选校方案，学生在门户确认后进入下一步。",
        completionCriteriaSnapshot: "学生完成首轮院校及课程排序确认",
        ownerId: butler.id,
        status: "IN_PROGRESS",
        progressPercent: 40,
        originalDueAt: shiftDays(now, -2),
        currentDueAt: shiftDays(now, -1),
        startedAt: shiftDays(now, -4),
      },
    });
    await prisma.taskTimelineEvent.createMany({
      data: [
        {
          taskId: overdueTask.id,
          eventType: "CREATED",
          actorId: administrator.id,
          actorRole: "ADMINISTRATOR",
          summary: "管理员创建学生确认任务",
          createdAt: shiftDays(now, -5),
        },
        {
          taskId: overdueTask.id,
          eventType: "STARTED",
          actorId: butler.id,
          actorRole: "BUTLER",
          summary: "管家开始整理选校与课程排序",
          createdAt: shiftDays(now, -4),
        },
        {
          taskId: overdueTask.id,
          eventType: "EXTENSION_REPORTED",
          actorId: butler.id,
          actorRole: "BUTLER",
          summary: "管家提交延期报备",
          reason: "等待学生确认家庭预算和课程优先级",
          createdAt: shiftDays(now, -1),
        },
        {
          taskId: overdueTask.id,
          eventType: "OVERDUE_ALERT_GENERATED",
          summary: "系统生成逾期提醒并进入监督看板",
          createdAt: shiftDays(now, -1),
        },
      ],
    });
    await prisma.taskProgressRecord.create({
      data: {
        taskId: overdueTask.id,
        progressNote: "已向学生讲解首轮方案，等待确认预算与课程优先级。",
        progressPercent: 40,
        createdById: butler.id,
        createdAt: shiftDays(now, -1),
      },
    });
    await prisma.taskExtensionReport.create({
      data: {
        taskId: overdueTask.id,
        extensionReason: "等待学生确认家庭预算和课程优先级",
        expectedFinishAt: shiftDays(now, 2),
        reportedById: butler.id,
        reportedAt: shiftDays(now, -1),
      },
    });
    await prisma.overdueAlert.create({
      data: {
        taskId: overdueTask.id,
        overdueEpisodeNo: 1,
        status: "OPEN",
        firstOverdueAt: shiftDays(now, -1),
        generatedAt: shiftDays(now, -1),
      },
    });

    const materialStage = stageInstances.get("MATERIALS")!;
    const materialScenarios = new Map([
      ["IDENTITY", { status: "APPROVED" as const, dueDays: 3 }],
      ["TRANSCRIPT", { status: "PENDING_REVIEW" as const, dueDays: 4 }],
      ["PREDICTED_GRADES", { status: "PARTIALLY_MISSING" as const, dueDays: 7 }],
      ["SELF_RECOMMENDATION", { status: "REQUIRED" as const, dueDays: 10 }],
    ]);
    const materialTemplates = sop.stages
      .flatMap((stage) => stage.materials)
      .sort((left, right) => left.sequenceNo - right.sequenceNo);
    const materialItems = new Map<string, { id: string; taskId: string | null }>();
    for (const template of materialTemplates) {
      const scenario = materialScenarios.get(template.materialType.code);
      const status = scenario?.status ?? ("REQUIRED" as const);
      const dueAt = shiftDays(now, scenario?.dueDays ?? template.deadlineOffsetDays ?? 7);
      const item = await prisma.materialItem.create({
        data: {
          studentId: student.id,
          materialTypeId: template.materialTypeId,
          sopMaterialTemplateId: template.id,
          templateKeySnapshot: template.templateKey,
          title: template.title,
          requirement: template.requirement,
          origin: "SOP_TEMPLATE",
          requirementKind: template.requirementKind,
          deadlineRule: template.deadlineRule,
          deadlineOffsetDays: template.deadlineOffsetDays,
          fixedDueAtSnapshot: template.fixedDueAt,
          conditionRuleSnapshot: template.conditionRule ?? undefined,
          conditionMatched: true,
          dueAt,
          ownerId: butler.id,
          status,
          missingReason: status === "PARTIALLY_MISSING" ? "学校尚未出具最终预测成绩证明" : null,
          expectedSubmitAt: status === "PARTIALLY_MISSING" ? shiftDays(now, 6) : null,
        },
      });
      let taskId: string | null = null;
      if (template.requirementKind !== "OPTIONAL") {
        const taskCompleted = status === "APPROVED";
        const taskInProgress = status === "PENDING_REVIEW";
        const task = await prisma.taskInstance.create({
          data: {
            studentId: student.id,
            serviceActivationId: activation.id,
            stageInstanceId: materialStage.id,
            sopVersionId: sop.id,
            sourceType: "MATERIAL",
            sourceObjectId: item.id,
            isBlockingSnapshot: true,
            externalVisible: true,
            titleSnapshot: `收集并审核：${template.title}`,
            descriptionSnapshot: template.requirement,
            completionCriteriaSnapshot: "资料已审核通过，或已记录缺失原因和补交时间",
            ownerId: butler.id,
            status: taskCompleted ? "COMPLETED" : taskInProgress ? "IN_PROGRESS" : "TODO",
            progressPercent: taskCompleted ? 100 : taskInProgress ? 80 : 0,
            originalDueAt: dueAt,
            currentDueAt: dueAt,
            startedAt: taskCompleted || taskInProgress ? shiftDays(now, -3) : null,
            completedAt: taskCompleted ? shiftDays(now, -2) : null,
            completionNote: taskCompleted ? "学生已上传，管家审核通过。" : null,
          },
        });
        taskId = task.id;
        await prisma.taskTimelineEvent.create({
          data: {
            taskId,
            eventType: taskCompleted
              ? "COMPLETED"
              : taskInProgress
                ? "PROGRESS_UPDATED"
                : "CREATED",
            actorId: taskCompleted || taskInProgress ? butler.id : administrator.id,
            actorRole: taskCompleted || taskInProgress ? "BUTLER" : "ADMINISTRATOR",
            summary: taskCompleted
              ? "管家审核资料并完成关联任务"
              : taskInProgress
                ? "学生已上传资料，等待管家审核"
                : "启用服务时生成核心资料任务",
          },
        });
      }
      materialItems.set(template.materialType.code, { id: item.id, taskId });
    }

    for (const scenario of [
      { code: "IDENTITY", title: "身份证明演示文件", reviewStatus: "APPROVED" as const },
      { code: "TRANSCRIPT", title: "中六成绩单演示文件", reviewStatus: "PENDING" as const },
    ]) {
      const material = materialItems.get(scenario.code)!;
      const storageKey = `materials/${student.id}/demo-${scenario.code.toLowerCase()}.pdf`;
      const stored = await storeDemoPdf(storageKey, scenario.title);
      const version = await prisma.materialVersion.create({
        data: {
          materialItemId: material.id,
          versionNo: 1,
          fileName: `${scenario.title}.pdf`,
          mimeType: "application/pdf",
          fileSize: stored.fileSize,
          storageKey,
          fileHash: stored.fileHash,
          uploadedById: portalUser.id,
          uploadedAt: shiftDays(now, -3),
          reviewStatus: scenario.reviewStatus,
          reviewedById: scenario.reviewStatus === "APPROVED" ? butler.id : null,
          reviewedAt: scenario.reviewStatus === "APPROVED" ? shiftDays(now, -2) : null,
          reviewComment: scenario.reviewStatus === "APPROVED" ? "文件清晰完整，已审核通过。" : null,
        },
      });
      const submittedAt = shiftDays(now, -3);
      const approved = scenario.reviewStatus === "APPROVED";
      const submission = await prisma.materialSubmission.create({
        data: {
          materialItemId: material.id,
          submissionNo: 1,
          status: approved ? "APPROVED" : "PENDING_REVIEW",
          source: "STUDENT",
          createdById: portalUser.id,
          submittedById: portalUser.id,
          submittedAt,
          reviewStartedById: approved ? butler.id : null,
          reviewStartedAt: approved ? shiftDays(now, -2) : null,
          reviewedById: approved ? butler.id : null,
          reviewedAt: approved ? shiftDays(now, -2) : null,
          reviewComment: approved ? "文件清晰完整，已审核通过。" : null,
          files: {
            create: {
              fileName: `${scenario.title}.pdf`,
              mimeType: "application/pdf",
              fileSize: stored.fileSize,
              storageKey,
              fileHash: stored.fileHash,
              uploadedById: portalUser.id,
              uploadedAt: submittedAt,
              reviewStatus: scenario.reviewStatus,
              reviewedById: approved ? butler.id : null,
              reviewedAt: approved ? shiftDays(now, -2) : null,
              reviewComment: approved ? "文件清晰完整，已审核通过。" : null,
            },
          },
        },
      });
      await prisma.materialItem.update({
        where: { id: material.id },
        data: { currentVersionId: version.id, currentSubmissionId: submission.id },
      });
    }

    await prisma.materialFollowup.create({
      data: {
        materialItemId: materialItems.get("PREDICTED_GRADES")!.id,
        taskId: materialItems.get("PREDICTED_GRADES")!.taskId!,
        followupNote: "管家已提醒学生向学校申请正式预测成绩，预计 6 天内补交。",
        followedById: butler.id,
        followedAt: shiftDays(now, -1),
      },
    });

    const directApplication = await prisma.application.create({
      data: {
        studentId: student.id,
        channel: "HK_DIRECT",
        institutionName: "香港大学",
        programName: "Bachelor of Arts",
        programChoices: ["Bachelor of Arts"],
        roundName: "Early Round",
        deadlineAt: shiftDays(now, 25),
        deadlineMode: "FIXED",
        requestBasis: "学生已确认申请香港大学 Bachelor of Arts，授权管家开始外部申请。",
        status: "SUBMISSION_PENDING_EVIDENCE",
        submittedAt: shiftDays(now, -2),
        applicationNo: "HKU-DEMO-2026-001",
        ownerId: butler.id,
        activities: {
          create: {
            activityType: "SUBMISSION_RECORDED",
            note: "已完成外部申请操作，等待补充成功页截图。",
            occurredAt: shiftDays(now, -2),
            operatorId: butler.id,
            applicationNoSnapshot: "HKU-DEMO-2026-001",
          },
        },
      },
    });
    await prisma.applicationStatusLog.createMany({
      data: [
        {
          applicationId: directApplication.id,
          toStatus: "PLANNING",
          note: "管理员建立香港大学申请记录",
          operatorId: administrator.id,
          changedAt: shiftDays(now, -8),
        },
        {
          applicationId: directApplication.id,
          fromStatus: "PLANNING",
          toStatus: "CONFIRMED",
          note: "管家与学生确认首轮申请方向",
          operatorId: butler.id,
          changedAt: shiftDays(now, -5),
        },
        {
          applicationId: directApplication.id,
          fromStatus: "CONFIRMED",
          toStatus: "SUBMISSION_PENDING_EVIDENCE",
          note: "外部申请已操作，等待补充递交凭证",
          operatorId: butler.id,
          changedAt: shiftDays(now, -2),
        },
      ],
    });

    const jupasApplication = await prisma.application.create({
      data: {
        studentId: student.id,
        channel: "JUPAS",
        institutionName: "JUPAS",
        programName: "首轮课程排序",
        programChoices: ["JS1001 文学士", "JS1010 工商管理", "JS1200 社会科学"],
        preferenceNo: 1,
        deadlineAt: shiftDays(now, 18),
        deadlineMode: "FIXED",
        requestBasis: "学生已确认首轮 JUPAS 志愿顺序。",
        status: "MATERIAL_PREPARATION",
        ownerId: butler.id,
        activities: {
          create: {
            activityType: "CREATED",
            note: "已按学生确认的志愿顺序创建 JUPAS 申请记录。",
            occurredAt: shiftDays(now, -3),
            operatorId: butler.id,
          },
        },
      },
    });
    await prisma.applicationStatusLog.createMany({
      data: [
        {
          applicationId: jupasApplication.id,
          toStatus: "PLANNING",
          note: "建立 JUPAS 申请记录",
          operatorId: administrator.id,
          changedAt: shiftDays(now, -7),
        },
        {
          applicationId: jupasApplication.id,
          fromStatus: "PLANNING",
          toStatus: "MATERIAL_PREPARATION",
          note: "管家整理课程排序并等待学生确认",
          operatorId: butler.id,
          changedAt: shiftDays(now, -3),
        },
      ],
    });
    await prisma.applicationRequirement.create({
      data: {
        applicationId: jupasApplication.id,
        requirementType: "STUDENT_CONFIRMATION",
        description: "学生确认首轮课程排序与优先级",
        dueAt: shiftDays(now, 2),
        linkedTaskId: overdueTask.id,
        status: "OPEN",
      },
    });

    await prisma.studentConfirmation.create({
      data: {
        studentId: student.id,
        objectType: "application",
        objectId: jupasApplication.id,
        prompt: "请确认首轮选校方案和 JUPAS 课程排序是否符合你的意向。",
        status: "PENDING",
        dueAt: shiftDays(now, 2),
      },
    });

    const issue = await prisma.issue.create({
      data: {
        studentId: student.id,
        linkedTaskId: materialItems.get("TRANSCRIPT")!.taskId!,
        category: "资料审核",
        description: "学生上传的成绩单缺少学校盖章页，请确认补交流程。",
        context: "管家审核学生上传的中六成绩单时发现最后一页缺少学校盖章。",
        priority: "中",
        status: "RESPONDED",
        submittedById: butler.id,
        submittedAt: shiftDays(now, -2),
        managerResponse: "先保留当前版本并通知学生补交盖章页，资料任务继续保持进行中。",
        respondedAt: shiftDays(now, -1),
      },
    });
    await prisma.issueLog.createMany({
      data: [
        {
          issueId: issue.id,
          action: "CREATED",
          note: "管家提交资料审核问题",
          operatorId: butler.id,
          createdAt: shiftDays(now, -2),
        },
        {
          issueId: issue.id,
          action: "RESPONDED",
          note: "管理员给出补交处理方案",
          operatorId: administrator.id,
          createdAt: shiftDays(now, -1),
        },
      ],
    });

    const profileEvidenceKey = `task-evidence/${stageTasks.get("PROFILE")!.id}/demo-profile-check.pdf`;
    const profileEvidence = await storeDemoPdf(profileEvidenceKey, "学生建档核对记录");
    await prisma.taskEvidence.create({
      data: {
        taskId: stageTasks.get("PROFILE")!.id,
        fileName: "学生建档核对记录.pdf",
        mimeType: "application/pdf",
        fileSize: profileEvidence.fileSize,
        storageKey: profileEvidenceKey,
        fileHash: profileEvidence.fileHash,
        uploadedById: butler.id,
        createdAt: shiftDays(enabledAt, 1),
      },
    });

    await prisma.notification.createMany({
      data: [
        {
          recipientId: administrator.id,
          eventType: "TASK_EXTENSION_REPORTED",
          title: "管家提交延期报备",
          content: "陈乐怡 · 确认首轮选校与课程排序",
          objectType: "task",
          objectId: overdueTask.id,
          actionUrl: `/workspace/tasks/${overdueTask.id}`,
          eventKey: "demo:admin:extension",
          createdAt: shiftDays(now, -1),
        },
        {
          recipientId: administrator.id,
          eventType: "ISSUE_SUBMITTED",
          title: "管家提交资料审核问题",
          content: "陈乐怡的成绩单缺少学校盖章页",
          objectType: "issue",
          objectId: issue.id,
          actionUrl: "/workspace/issues",
          eventKey: "demo:admin:issue",
          createdAt: shiftDays(now, -2),
        },
        {
          recipientId: butler.id,
          eventType: "MATERIAL_UPLOADED",
          title: "学生上传了新资料",
          content: "陈乐怡已上传中六成绩单，等待审核。",
          objectType: "material",
          objectId: materialItems.get("TRANSCRIPT")!.id,
          actionUrl: "/workspace/materials",
          eventKey: "demo:butler:material",
          createdAt: shiftDays(now, -3),
        },
        {
          recipientId: butler.id,
          eventType: "TASK_ASSIGNED",
          title: "收到学生服务任务",
          content: "陈乐怡 · 确认首轮选校与课程排序",
          objectType: "task",
          objectId: overdueTask.id,
          actionUrl: `/workspace/tasks/${overdueTask.id}`,
          eventKey: "demo:butler:task",
          createdAt: shiftDays(now, -5),
        },
        {
          recipientId: portalUser.id,
          eventType: "STAGE_CHANGED",
          title: "服务进入升学规划阶段",
          content: "学情评估已完成，接下来请确认首轮选校与课程排序。",
          objectType: "student",
          objectId: student.id,
          actionUrl: "/portal/progress",
          eventKey: "demo:student:stage",
          createdAt: shiftDays(now, -8),
        },
        {
          recipientId: portalUser.id,
          eventType: "APPLICATION_STATUS_CHANGED",
          title: "香港大学申请已递交",
          content: "申请编号 HKU-DEMO-2026-001，可在申请进度中查看。",
          objectType: "application",
          objectId: directApplication.id,
          actionUrl: "/portal/applications",
          eventKey: "demo:student:application",
          createdAt: shiftDays(now, -2),
        },
      ],
    });

    await prisma.auditLog.createMany({
      data: [
        {
          operatorId: administrator.id,
          operatorRole: "ADMINISTRATOR",
          objectType: "sop_version",
          objectId: sop.id,
          action: "SOP_PUBLISHED",
          afterData: { versionNo: 1, status: "PUBLISHED" },
          reason: "发布演示基础 SOP",
          requestId: "demo-seed-sop",
          createdAt: shiftDays(enabledAt, -1),
        },
        {
          operatorId: administrator.id,
          operatorRole: "ADMINISTRATOR",
          objectType: "student",
          objectId: student.id,
          action: "STUDENT_CREATED",
          afterData: { studentNo: student.studentNo, defaultButlerId: butler.id },
          reason: "建立演示学生并分配管家",
          requestId: "demo-seed-student",
          createdAt: enabledAt,
        },
        {
          operatorId: administrator.id,
          operatorRole: "ADMINISTRATOR",
          objectType: "student_service",
          objectId: activation.id,
          action: "SERVICE_ACTIVATED",
          afterData: { sopVersionNo: 1, taskCount: 13 },
          reason: "启用学生服务并套用八阶段 SOP",
          requestId: "demo-seed-activation",
          createdAt: enabledAt,
        },
        {
          operatorId: butler.id,
          operatorRole: "BUTLER",
          objectType: "task",
          objectId: overdueTask.id,
          action: "TASK_EXTENSION_REPORTED",
          afterData: { expectedFinishAt: shiftDays(now, 2).toISOString() },
          reason: "等待学生确认家庭预算和课程优先级",
          requestId: "demo-seed-extension",
          createdAt: shiftDays(now, -1),
        },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}

await main();
