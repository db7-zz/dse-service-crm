# DSE升学服务CRM

DSE升学服务CRM的阶段0技术底座。当前版本只包含认证、权限、管理员账号、审计、管理端布局、
公共组件和工程质量体系。

## 前置条件

- Node.js 24 LTS
- pnpm 11
- Docker Desktop或Docker Engine与Compose

## 本地启动

1. 复制 `.env.example` 为 `.env`，替换开发种子密码。
2. 安装依赖：`pnpm install`
3. 启动数据库：`docker compose up -d postgres`
4. 生成客户端并迁移：`pnpm db:generate && pnpm db:migrate:deploy`
5. 创建开发账号：`pnpm db:seed`
6. 启动前后端：`pnpm dev`

本机直接开发时访问 `http://localhost:3000`；API位于 `http://localhost:3001`。
根目录 `.env` 会由API、Prisma迁移和种子命令自动加载。

也可使用 `docker compose up --build` 启动同源入口，浏览
`http://localhost:8080`。

staging和production使用独立Compose项目名，因此数据库卷、网络和容器不会与开发环境
复用。复制对应示例环境文件，填写真实密码后执行：

```text
docker compose -f docker-compose.yml -f docker-compose.staging.yml --env-file .env.staging up --build
docker compose -f docker-compose.yml -f docker-compose.production.yml --env-file .env.production up --build
```

两个覆盖文件会在必需数据库变量或HTTPS站点来源缺失时拒绝启动。

## 常用命令

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm openapi:generate
pnpm db:validate
pnpm db:diff
pnpm check
```

`pnpm check`会执行与本地无数据库质量门禁对应的格式、Lint、类型、单元/组件测试和生产构建。
数据库集成测试与端到端测试需要先按下方测试说明启动独立测试数据库。

## 测试

安装Docker后，可在独立的临时测试数据库中执行完整检查：

```text
docker compose -f docker-compose.test.yml up -d
$env:TEST_DATABASE_URL="postgresql://dse_crm_test:dse_crm_test_only@localhost:55432/dse_crm_test?schema=public"
$env:DATABASE_URL=$env:TEST_DATABASE_URL
$env:SEED_ADMIN_PASSWORD="replace-with-a-local-6-character-password"
$env:SEED_BUTLER_PASSWORD="replace-with-a-local-6-character-password"
pnpm db:migrate:deploy
pnpm db:seed
pnpm test
pnpm test:e2e
```

以上环境变量示例适用于PowerShell。测试数据库与开发、staging和production数据库隔离。

## 环境

`NODE_ENV`只允许 `development`、`test`、`staging`、`production`。staging和production
缺少安全配置时API拒绝启动。开发种子命令拒绝在staging和production执行。

## API

- 运行时文档（非生产）：`/api/docs`
- 版本控制契约：`docs/api/openapi.json`
- 所有业务接口使用 `/api/v1` 前缀和统一响应封装。

## 当前范围

S0不会创建学生、任务、资料、申请或学生端业务。路线图见
`docs/product/ROADMAP.md`，S0验收见
`docs/releases/S0-技术底座/INCREMENT_PRD_S0.md`。
