import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @dse/api exec nest start",
      url: "http://localhost:3001/api/v1/health/live",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_ORIGIN: "http://localhost:3000",
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          "postgresql://dse_crm_test:dse_crm_test_only@localhost:55432/dse_crm_test?schema=public",
      },
    },
    {
      command: "pnpm --filter @dse/web dev",
      url: "http://localhost:3000/login",
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        NODE_ENV: "test",
        NEXT_PUBLIC_API_BASE_URL: "/api/v1",
      },
    },
  ],
});
