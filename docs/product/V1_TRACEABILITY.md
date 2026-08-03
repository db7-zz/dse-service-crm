# V1.0总PRD需求追踪矩阵

本矩阵只引用 `MASTER_PRD.md`。历史增量文档保留但不参与当前验收。

| 总PRD              | 主要页面                                                 | API/服务                                                       | 核心数据                                                        | 验收证据                                  |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| 4.1 账号与权限     | `/login`、`/workspace/system/users`、`/forbidden`        | `auth`、`admin/users`、`StudentAccessService`                  | users、roles、permissions、user_roles                           | 认证/权限集成测试、菜单测试               |
| 4.2 监督看板       | `/workspace/supervision`                                 | `admin/task-supervision`、`admin/overdue-alerts`、学生风险汇总 | task_instances、overdue_alerts、students                        | 任务状态逻辑、管理员浏览器回归            |
| 4.3 管家任务       | `/workspace/my-tasks`、`/workspace/tasks/:id`            | `my/tasks`、`tasks`状态操作、凭证上传下载、逾期扫描            | task_instances及进度、延期、改期、转派、时间线、凭证表          | S1集成测试、任务格式/页面测试、端到端回归 |
| 4.4 学生档案与进度 | `/workspace/students`、学生详情及`record`                | `students`、`student-records`、`ServiceProgressService`        | students、scores、targets、service activations、stage instances | 学生集成测试、阶段纯逻辑测试              |
| 4.5 SOP            | `/workspace/sop`                                         | `sop`、学生启用服务                                            | SOP版本、阶段模板、任务模板及执行快照                           | SOP阻塞规则测试、S1/S2集成测试            |
| 4.6 资料           | `/workspace/materials`、`/portal/materials`              | `materials`、`portal/me/materials`、`FileStorageService`       | material types/items/versions/followups、task evidence          | 上传校验、权限与浏览器回归                |
| 4.7 分配交接       | 学生详情、任务详情                                       | `assign-butler`、`assign-planner`、批量任务分配、任务转派      | staff assignments、task reassignments、notifications            | 学生/任务集成测试、审计记录               |
| 4.8 申请           | `/workspace/applications`、`/portal/applications`        | `applications`、状态变化与需求任务、门户申请DTO                | applications、status logs、requirements、confirmations          | 状态图测试、门户隔离回归                  |
| 4.9 问题与专项     | `/workspace/issues`、专项老师任务页                      | `issues`、回复/补充/转任务/解决/关闭/重开                      | issues、issue logs、task instances                              | 状态图测试、角色浏览器回归                |
| 4.10 学生/家长端   | `/portal`及四个子页面                                    | 专用`portal/me/*`控制器与DTO                                   | 档案绑定、对外任务、资料、申请、确认                            | 门户DTO单元测试、手机宽度浏览器回归       |
| 4.11 通知与日志    | `/workspace/notifications`、`/portal/messages`、审计日志 | `notifications`、`audit-logs`、`OverdueScannerService`         | notifications、audit_logs、overdue_alerts                       | 去重约束、通知/审计浏览器回归             |
| 5 非功能           | 全局                                                     | Session/CSRF/Origin/限流、统一异常、日志、备份与迁移           | 全库                                                            | 安全单元测试、构建、迁移验证、备份说明    |

## 验收解释

- “业务负责人”在V1.0权限模型中由管理员角色承担，不保留并行的Eric专属角色。
- 家长复用经授权绑定的门户账号入口；对外DTO和学生行级关系是信息隔离边界。
- 文件下载使用已认证、已授权的受控接口；生产入口必须由HTTPS反向代理提供。
- 外部飞书归档和第三方消息通道只记录人工结果，V1.0不把第三方成功作为CRM事实落库的前置条件。
