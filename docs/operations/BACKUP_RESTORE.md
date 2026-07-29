# PostgreSQL备份与恢复

## 基线

- 每日执行一次自定义格式 `pg_dump`。
- 备份目录必须位于PostgreSQL数据卷之外，并复制至少一份到另一存储位置。
- 默认保留30天。
- 当前仓库不包含自动批量删除逻辑；运维人员按明确文件路径逐个清理超过保留期的文件。

## 创建备份

设置 `DATABASE_URL` 和 `BACKUP_DIRECTORY` 后执行：

```text
sh scripts/backup-postgres.sh
```

脚本同时生成SHA-256校验文件。

## 恢复演练

1. 创建全新的空PostgreSQL数据库。
2. 校验备份文件SHA-256。
3. 使用 `pg_restore --clean --if-exists` 恢复到演练数据库。
4. 执行 `prisma migrate status`。
5. 运行健康检查、管理员登录和审计查询。
6. 记录恢复耗时、数据时间点和异常。

生产恢复必须先停止写入并由业务负责人批准。
