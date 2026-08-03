# DSE升学服务CRM

DSE升学服务CRM v1.0.0，产品规格以 `docs/product/MASTER_PRD.md` 为唯一业务基线。当前版本覆盖账号与关系权限、监督看板、任务闭环、学生档案、八阶段SOP、资料版本与缺失催收、香港/JUPAS申请、问题与专项任务、学生端、站内通知及结构化审计。

完整角色操作说明见 `docs/operations/USER_GUIDE.md`，上线验收与需求映射见 `docs/releases/V1/V1_ACCEPTANCE.md` 和 `docs/product/V1_TRACEABILITY.md`。

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

## V1.0业务范围

- 管理员：全局监督、账号权限、SOP、学生团队分配、异常处置和审计。
- 管家：本人学生、任务执行、资料审核、申请跟进和问题提交。
- 规划老师：本人学生的学情、成绩、目标院校和服务概览。
- 专项老师：本人专项任务及完成任务所需的最小学生信息。
- 学生/家长入口：本人资料、对外进度、申请状态、待确认事项和消息。

历史增量文档保留用于版本追溯，但不再作为当前开发规格。
