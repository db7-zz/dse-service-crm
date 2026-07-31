import { config as loadEnvironment } from "dotenv";
import argon2 from "argon2";
import { createPrismaClient } from "./src/index.js";

loadEnvironment({
  path: new URL("../.env", import.meta.url),
  quiet: true,
});

const ROLE_DEFINITIONS = [
  ["ADMINISTRATOR", "管理员", "维护账号、角色、权限、审计和S1业务"],
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
  ["students.write", "维护学生最小档案与负责人"],
  ["sop.read", "查看SOP版本"],
  ["sop.write", "维护和发布SOP版本"],
  ["service.activation.write", "启用学生服务并套用SOP"],
  ["tasks.own.read", "查看本人负责的任务"],
  ["tasks.own.write", "执行本人负责的任务"],
  ["tasks.supervision.read", "查看全部任务与监督数据"],
  ["tasks.supervision.write", "改期、转派和取消任务"],
  ["overdue-alerts.read", "查看逾期提醒"],
  ["overdue-alerts.write", "处理逾期提醒"],
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMINISTRATOR: [
    "workspace.access",
    "system.users.read",
    "system.users.write",
    "system.audit.read",
    "students.read",
    "students.write",
    "sop.read",
    "sop.write",
    "service.activation.write",
    "tasks.supervision.read",
    "tasks.supervision.write",
    "overdue-alerts.read",
    "overdue-alerts.write",
  ],
  ERIC_MANAGER: [],
  BUTLER: ["workspace.access", "tasks.own.read", "tasks.own.write"],
  PLANNER: ["workspace.access"],
  SPECIALIST: ["workspace.access"],
  STUDENT: ["portal.access"],
};

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

async function main(): Promise<void> {
  const environment = process.env.NODE_ENV ?? "development";
  if (environment === "staging" || environment === "production") {
    throw new Error("The development seed is disabled in staging and production.");
  }

  const databaseUrl = required("DATABASE_URL");
  const adminPassword = required("SEED_ADMIN_PASSWORD");
  const butlerPassword = required("SEED_BUTLER_PASSWORD");
  if (adminPassword.length < 6 || butlerPassword.length < 6) {
    throw new Error("Seed passwords must contain at least 6 characters.");
  }

  const prisma = createPrismaClient(databaseUrl);
  try {
    for (const [code, name, description] of ROLE_DEFINITIONS) {
      await prisma.role.upsert({
        where: { code },
        update: { name, description },
        create: { code, name, description },
      });
    }

    for (const [code, name] of PERMISSION_DEFINITIONS) {
      await prisma.permission.upsert({
        where: { code },
        update: { name },
        create: { code, name },
      });
    }

    for (const [roleCode, permissionCodes] of Object.entries(ROLE_PERMISSIONS)) {
      const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
      const permissions = await prisma.permission.findMany({
        where: { code: { in: permissionCodes } },
      });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id,
          })),
        });
      }
    }

    const administratorRole = await prisma.role.findUniqueOrThrow({
      where: { code: "ADMINISTRATOR" },
    });
    const legacyManagerRole = await prisma.role.findUniqueOrThrow({
      where: { code: "ERIC_MANAGER" },
    });
    const activeLegacyRelations = await prisma.userRole.findMany({
      where: { roleId: legacyManagerRole.id, expiredAt: null },
    });
    const migratedAt = new Date();
    for (const relation of activeLegacyRelations) {
      const existingAdministratorRelation = await prisma.userRole.findUnique({
        where: {
          userId_roleId: {
            userId: relation.userId,
            roleId: administratorRole.id,
          },
        },
      });
      const effectiveAt =
        existingAdministratorRelation?.effectiveAt &&
        existingAdministratorRelation.effectiveAt < relation.effectiveAt
          ? existingAdministratorRelation.effectiveAt
          : relation.effectiveAt;
      await prisma.$transaction([
        prisma.userRole.upsert({
          where: {
            userId_roleId: {
              userId: relation.userId,
              roleId: administratorRole.id,
            },
          },
          update: {
            effectiveAt,
            expiredAt: null,
          },
          create: {
            userId: relation.userId,
            roleId: administratorRole.id,
            effectiveAt,
          },
        }),
        prisma.userRole.update({
          where: {
            userId_roleId: {
              userId: relation.userId,
              roleId: legacyManagerRole.id,
            },
          },
          data: { expiredAt: migratedAt },
        }),
      ]);
    }

    const accounts = [
      {
        username: process.env.SEED_ADMIN_USERNAME ?? "admin",
        displayName: "测试管理员",
        password: adminPassword,
        roleCode: "ADMINISTRATOR",
      },
      {
        username: process.env.SEED_BUTLER_USERNAME ?? "butler",
        displayName: "测试管家",
        password: butlerPassword,
        roleCode: "BUTLER",
      },
    ];

    for (const account of accounts) {
      const passwordHash = await argon2.hash(account.password, { type: argon2.argon2id });
      const user = await prisma.user.upsert({
        where: { username: account.username },
        update: {
          displayName: account.displayName,
          passwordHash,
          status: "ACTIVE",
          failedLoginCount: 0,
          failedLoginWindowStartedAt: null,
          lockedUntil: null,
        },
        create: {
          username: account.username,
          displayName: account.displayName,
          passwordHash,
          status: "ACTIVE",
        },
      });
      const role = await prisma.role.findUniqueOrThrow({ where: { code: account.roleCode } });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        update: { expiredAt: null },
        create: { userId: user.id, roleId: role.id },
      });
    }

    const administrator = await prisma.user.findUniqueOrThrow({
      where: { username: process.env.SEED_ADMIN_USERNAME ?? "admin" },
    });
    const existingBaseline = await prisma.sopVersion.findUnique({
      where: { versionNo: 1 },
      include: { stages: { include: { tasks: true } } },
    });
    if (!existingBaseline) {
      await prisma.sopVersion.create({
        data: {
          versionNo: 1,
          status: "DRAFT",
          createdById: administrator.id,
          stages: {
            create: SOP_BASELINE_STAGES.map(([stageCode, name], index) => ({
              stageCode,
              name,
              sequenceNo: index + 1,
              description: null,
              tasks: {
                create: {
                  ...SOP_BASELINE_TASKS[stageCode],
                  sequenceNo: 1,
                  ownerRole: "BUTLER",
                },
              },
            })),
          },
        },
      });
    } else if (existingBaseline.status === "DRAFT") {
      for (const [stageCode, name] of SOP_BASELINE_STAGES) {
        const sequenceNo =
          SOP_BASELINE_STAGES.findIndex(([candidate]) => candidate === stageCode) + 1;
        const stage = await prisma.sopStageTemplate.upsert({
          where: {
            sopVersionId_stageCode: {
              sopVersionId: existingBaseline.id,
              stageCode,
            },
          },
          update: {},
          create: {
            sopVersionId: existingBaseline.id,
            stageCode,
            name,
            sequenceNo,
          },
        });
        const existingTaskCount = await prisma.sopTaskTemplate.count({
          where: { stageTemplateId: stage.id },
        });
        if (existingTaskCount === 0) {
          await prisma.sopTaskTemplate.create({
            data: {
              stageTemplateId: stage.id,
              ...SOP_BASELINE_TASKS[stageCode],
              sequenceNo: 1,
              ownerRole: "BUTLER",
            },
          });
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

await main();
