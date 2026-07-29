import { expect, test } from "@playwright/test";

const loginButtonName = /登\s*录/;

test("administrator sees system management and can log out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(process.env.SEED_ADMIN_USERNAME ?? "admin");
  await page
    .getByLabel("密码")
    .fill(process.env.SEED_ADMIN_PASSWORD ?? "Admin-Development-Only-123!");
  await page.getByRole("button", { name: loginButtonName }).click();

  await expect(page.getByRole("heading", { name: "账号管理" })).toBeVisible();
  await expect(page.getByText("审计日志", { exact: true })).toBeVisible();
  await expect(page.getByText("监督管理看板", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "打开测试管理员的账户菜单" }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("butler cannot see system management", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(process.env.SEED_BUTLER_USERNAME ?? "butler");
  await page
    .getByLabel("密码")
    .fill(process.env.SEED_BUTLER_PASSWORD ?? "Butler-Development-Only-123!");
  await page.getByRole("button", { name: loginButtonName }).click();

  await expect(page.getByRole("heading", { name: "工作区" })).toBeVisible();
  await expect(page.getByText("账号管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("审计日志", { exact: true })).toHaveCount(0);
});
