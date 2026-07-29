# 贡献指南

## 分支

- `main`始终保持可运行。
- 使用 `feature/*`、`fix/*`、`docs/*`、`refactor/*` 和 `test/*`。
- 一个分支和PR只解决一个主要Issue。

## Commit

使用Conventional Commits，例如：

```text
feat(auth): add database-backed session
fix(permission): reject disabled users
docs(S0): record authentication decision
test(audit): cover role change log
```

## 提交前检查

必须运行：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

数据库变化必须包含迁移；接口变化必须更新OpenAPI；权限敏感变化必须包含API测试和审计事件。

## 评审

远程仓库建立前采用人工评审规则：任何功能分支合并到 `main` 前必须由产品负责人确认范围，
并由另一名开发者或指定审核人确认代码和测试。远程仓库建立后再启用CODEOWNERS和分支保护。
