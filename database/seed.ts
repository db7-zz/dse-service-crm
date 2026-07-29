import { config as loadEnvironment } from "dotenv";
import argon2 from "argon2";
import { createPrismaClient } from "./src/index.js";

loadEnvironment({
  path: new URL("../.env", import.meta.url),
  quiet: true,
});

const ROLE_DEFINITIONS = [
  ["ADMINISTRATOR", "管理员", "维护账号、角色、权限和审计"],
  ["ERIC_MANAGER", "业务负责人", "使用监督管理端进行全局监督"],
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
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMINISTRATOR: [
    "workspace.access",
    "system.users.read",
    "system.users.write",
    "system.audit.read",
  ],
  ERIC_MANAGER: ["workspace.access", "supervision.access"],
  BUTLER: ["workspace.access"],
  PLANNER: ["workspace.access"],
  SPECIALIST: ["workspace.access"],
  STUDENT: ["portal.access"],
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
  if (adminPassword.length < 12 || butlerPassword.length < 12) {
    throw new Error("Seed passwords must contain at least 12 characters.");
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
      await prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
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
        update: { displayName: account.displayName, passwordHash, status: "ACTIVE" },
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
  } finally {
    await prisma.$disconnect();
  }
}

await main();
