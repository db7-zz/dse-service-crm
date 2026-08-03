export function assertSafeTestDatabaseUrl(connectionString: string): void {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const looksLikeTestDatabase = /(^|[_-])(test|ci)([_-]|$)/i.test(databaseName);

  if (!databaseName || !looksLikeTestDatabase) {
    throw new Error(
      `TEST_DATABASE_URL 必须指向名称包含 test 或 ci 的独立数据库；当前数据库为 ${databaseName || "未知"}`,
    );
  }
}
