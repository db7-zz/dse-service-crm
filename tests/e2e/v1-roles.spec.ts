import { expect, test, type Page } from "@playwright/test";

const loginButtonName = /登\s*录/;

async function login(page: Page, role: "admin" | "planner" | "specialist" | "student") {
  const keys = {
    admin: ["SEED_ADMIN_USERNAME", "SEED_ADMIN_PASSWORD", "admin"],
    planner: ["SEED_PLANNER_USERNAME", "SEED_PLANNER_PASSWORD", "planner"],
    specialist: ["SEED_SPECIALIST_USERNAME", "SEED_SPECIALIST_PASSWORD", "specialist"],
    student: ["SEED_STUDENT_USERNAME", "SEED_STUDENT_PASSWORD", "student"],
  } as const;
  const [usernameKey, passwordKey, fallbackUsername] = keys[role];
  const fallbackPassword =
    role === "admin"
      ? "Admin-Development-Only-123!"
      : (process.env.SEED_BUTLER_PASSWORD ?? "Butler-Development-Only-123!");
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(process.env[usernameKey] ?? fallbackUsername);
  await page.getByLabel("密码").fill(process.env[passwordKey] ?? fallbackPassword);
  await page.getByRole("button", { name: loginButtonName }).click();
}

test("administrator can open every V1 internal operation area", async ({ page }) => {
  await login(page, "admin");
  for (const [label, path, heading] of [
    ["资料管理", "/workspace/materials", "资料管理"],
    ["申请管理", "/workspace/applications", "申请管理"],
    ["问题协同", "/workspace/issues", "问题协同"],
    ["消息与待办", "/workspace/notifications", "消息与待办"],
  ] as const) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
});

test("planner is scoped to own students and planning views", async ({ page }) => {
  await login(page, "planner");
  await expect(page).toHaveURL(/\/workspace\/students/);
  await expect(page.getByRole("link", { name: "学生管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "资料管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "申请管理" })).toBeVisible();
  await expect(page.getByText("监督管理看板", { exact: true })).toHaveCount(0);
  await page.goto("/workspace/supervision");
  await expect(page.getByText(/没有访问此页面的权限/)).toBeVisible();
});

test("specialist sees own work but no global student directory", async ({ page }) => {
  await login(page, "specialist");
  await expect(page).toHaveURL(/\/workspace\/my-tasks/);
  await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  await expect(page.getByRole("link", { name: "问题协同" })).toBeVisible();
  await expect(page.getByText("学生管理", { exact: true })).toHaveCount(0);
  await page.goto("/workspace/students");
  await expect(page.getByText(/没有访问此页面的权限/)).toBeVisible();
});

test("student portal is responsive and isolated from internal workspace", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "student");
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole("heading", { name: /你好/ })).toBeVisible();
  for (const [label, path, heading] of [
    ["我的资料", "/portal/materials", "我的资料"],
    ["服务进度", "/portal/progress", "服务进度"],
    ["申请动态", "/portal/applications", "申请动态"],
    ["消息", "/portal/messages", "消息"],
  ] as const) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
  await page.goto("/workspace/supervision");
  await expect(page.getByText(/没有访问此页面的权限/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务监督闭环" })).toHaveCount(0);
});
