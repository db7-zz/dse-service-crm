# S0 测试与验收计划

## 自动化检查

| 检查       | 命令                               | 当前覆盖                                                           |
| ---------- | ---------------------------------- | ------------------------------------------------------------------ |
| 格式       | `pnpm format:check`                | 源码、配置和文档                                                   |
| Lint       | `pnpm lint`                        | 七个工作区包                                                       |
| 类型       | `pnpm typecheck`                   | API、Web、数据库与公共包                                           |
| 单元/组件  | `pnpm test`                        | Argon2id、锁定、会话、RBAC、环境、审计差异、错误映射、菜单与UI状态 |
| 数据库结构 | `pnpm db:validate`、`pnpm db:diff` | Prisma schema及空库目标SQL                                         |
| 接口契约   | `pnpm openapi:generate`            | 12条S0路由与统一响应结构                                           |
| 构建       | `pnpm build`                       | NestJS与Next.js生产构建                                            |
| API集成    | `TEST_DATABASE_URL=... pnpm test`  | 登录、CSRF、401/403、账号、角色、启停、审计、幂等退出              |
| E2E        | `pnpm test:e2e`                    | 管理员/管家登录、菜单、退出和权限隔离                              |

## 数据库与Compose验收

本机安装Docker后执行：

```text
docker compose -f docker-compose.test.yml up -d
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:e2e
```

必须验证空数据库迁移、种子、迁移状态、ready健康检查以及容器重启后的会话行为。
测试数据库使用tmpfs，不得连接开发或生产数据库。

## 人工验收

1. 管理员登录后只看到工作区、账号管理和审计日志。
2. 业务负责人登录后看到“监督管理端”和“监督管理看板”命名。
3. 管家登录后只看到工作区占位页。
4. 学生角色不能进入内部工作区。
5. 管理员创建账号、调整角色、停用和启用账号后，审计日志保留前后值、原因和requestId。
6. 未认证、无权限、失效会话、错误CSRF和错误Origin返回稳定错误码，不暴露底层异常。
7. 在桌面和390px宽度下，登录页无横向溢出，表单和错误状态可读。

只有自动化、数据库/Compose和人工验收全部完成，才允许创建`v0.1.0`标签。
