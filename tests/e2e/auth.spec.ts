import { expect, test } from "@playwright/test";

const loginButtonName = /登\s*录/;

test("administrator creates a minimal student and sees future service entries", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("登录账号").fill(process.env.SEED_ADMIN_USERNAME ?? "admin");
  await page
    .getByLabel("密码")
    .fill(process.env.SEED_ADMIN_PASSWORD ?? "Admin-Development-Only-123!");
  await page.getByRole("button", { name: loginButtonName }).click();

  await expect(
    page.getByRole("heading", { name: "每一位学生，都从一份清晰档案开始。" }),
  ).toBeVisible();
  await expect(page.getByText("学生管理", { exact: true })).toBeVisible();
  await expect(page.getByText("审计日志", { exact: true })).toBeVisible();
  await expect(page.getByText("监督管理看板", { exact: true })).toBeVisible();
  await expect(page.getByText("SOP 版本", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "新建学生" }).click();
  await page.getByLabel("学生姓名（必填）").fill("黄翰");
  await page.getByLabel("联系电话").fill("+852 6123 4567");
  await page.getByLabel("联系邮箱").fill("hon.wong@example.com");
  await page.getByRole("button", { name: "保存并查看详情" }).click();

  await expect(page.getByRole("heading", { name: "黄翰" })).toBeVisible();
  await expect(page.getByText("服务未启用")).toBeVisible();
  await expect(page.getByRole("button", { name: "启用服务" })).toBeEnabled();
  await expect(page.getByRole("button", { name: /批量分配任务/ })).toBeDisabled();

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

  await expect(page.getByRole("heading", { name: "我的任务" })).toBeVisible();
  await expect(page.getByRole("link", { name: "我的任务" })).toBeVisible();
  await expect(page.getByText("账号管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("审计日志", { exact: true })).toHaveCount(0);
  await expect(page.getByText("监督管理看板", { exact: true })).toHaveCount(0);
  await expect(page.getByText("学生管理", { exact: true })).toHaveCount(0);

  await page.goto("/workspace/students");
  await expect(page.getByText("你没有访问此页面的权限")).toBeVisible();
});
