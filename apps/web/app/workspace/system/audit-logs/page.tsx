"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PermissionCode } from "@dse/shared";
import {
  Button,
  Descriptions,
  Drawer,
  Select,
  Space,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { DataTable, ErrorState, FilterBar } from "@dse/ui";
import { PermissionPage } from "../../../../src/auth/permission-page";
import { apiClient } from "../../../../src/auth/api";
import { PageShell } from "../../../../src/layout/page-shell";

const ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "登录成功",
  LOGIN_FAILED: "登录失败",
  LOGOUT: "退出登录",
  ACCOUNT_LOCKED: "账号锁定",
  PERMISSION_DENIED: "权限访问被拒绝",
  USER_CREATED: "创建账号",
  USER_UPDATED: "更新账号",
  USER_ROLES_CHANGED: "调整账号角色",
  USER_ENABLED: "启用账号",
  USER_DISABLED: "停用账号",
  STUDENT_CREATED: "创建学生档案",
  STUDENT_UPDATED: "更新学生档案",
  STUDENT_DEFAULT_BUTLER_CHANGED: "调整默认管家",
  STUDENT_PLANNER_CHANGED: "调整规划老师",
  STUDENT_SERVICE_ENABLED: "启用学生服务",
  STUDENT_PROGRESS_ACCESS_DENIED: "拒绝访问学生服务进度",
  SOP_DRAFT_CREATED: "创建 SOP 草稿",
  SOP_DRAFT_UPDATED: "更新 SOP 草稿",
  SOP_TASK_BLOCKING_CONFIGURATION_CHANGED: "调整 SOP 阻塞任务",
  SOP_PUBLISH_REJECTED_NO_BLOCKING_TASK: "拒绝发布无阻塞任务的 SOP",
  SOP_VERSION_PUBLISHED: "发布 SOP 版本",
  SOP_VERSION_RETIRED: "归档 SOP 历史版本",
  TASK_ASSIGNED: "分配任务",
  TASK_STARTED: "开始任务",
  TASK_PROGRESS_UPDATED: "更新任务进展",
  TASK_EXTENSION_REPORTED: "提交延期报备",
  TASK_COMPLETED: "完成任务",
  TASK_RESCHEDULED: "调整任务截止时间",
  TASK_REASSIGNED: "转派任务",
  TASK_CANCELED: "取消任务",
  MANUAL_TASK_CREATED: "创建临时任务",
  SERVICE_STAGE_STARTED: "启动服务阶段",
  SERVICE_STAGE_COMPLETED: "完成服务阶段",
  SERVICE_PROGRESS_RECALCULATED: "重算服务进度",
  SERVICE_PROGRESS_CALCULATION_FAILED: "服务进度计算失败",
  SERVICE_PROGRESS_RECALCULATION_FAILED: "服务进度重算失败",
  SERVICE_PROGRESS_CONFLICT: "服务进度并发冲突",
  S2_PROGRESS_MIGRATION_EXECUTED: "执行 S2 服务进度迁移",
  OVERDUE_ALERT_GENERATED: "生成逾期提醒",
  OVERDUE_ALERT_HANDLED: "处理逾期提醒",
  OVERDUE_ALERT_RESOLVED: "解除逾期提醒",
};

const OBJECT_LABELS: Record<string, string> = {
  user: "账号",
  session: "登录会话",
  permission: "权限",
  student: "学生",
  sop_version: "SOP 版本",
  task: "任务",
  overdue_alert: "逾期提醒",
  stage_instance: "服务阶段",
  student_service_activation: "服务进度",
  student_service_progress: "学生服务进度",
};

const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATOR: "管理员",
  BUTLER: "管家",
  PLANNER: "规划老师",
  SPECIALIST: "专项老师",
  STUDENT: "学生",
  SYSTEM: "系统",
};

interface AuditRecord {
  id: string;
  operatorId: string | null;
  operatorRole: string | null;
  operator: {
    id: string;
    displayName: string;
    username: string;
  } | null;
  objectType: string;
  objectId: string | null;
  action: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
  reason: string | null;
  requestId: string;
  ipAddress: string | null;
  deviceInfo: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditRecord[];
  page: number;
  pageSize: number;
  total: number;
}

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function objectLabel(objectType: string) {
  return OBJECT_LABELS[objectType] ?? objectType;
}

function objectHref(record: AuditRecord) {
  if (!record.objectId) return undefined;
  if (record.objectType === "student") return `/workspace/students/${record.objectId}`;
  if (record.objectType === "task") return `/workspace/tasks/${record.objectId}`;
  return undefined;
}

function jsonText(value: Record<string, unknown> | null) {
  return value ? JSON.stringify(value, null, 2) : "无";
}

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditPage>({ items: [], page: 1, pageSize: 20, total: 0 });
  const [action, setAction] = useState("");
  const [objectType, setObjectType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [selected, setSelected] = useState<AuditRecord>();

  const load = useCallback(
    async (page: number, pageSize: number) => {
      setLoading(true);
      setError(undefined);
      try {
        const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (action) query.set("action", action);
        if (objectType) query.set("objectType", objectType);
        setData(await apiClient.request<AuditPage>(`/admin/audit-logs?${query.toString()}`));
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "审计日志加载失败");
      } finally {
        setLoading(false);
      }
    },
    [action, objectType],
  );

  useEffect(() => {
    void load(1, 20);
  }, [load]);

  const columns: TableColumnsType<AuditRecord> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 190,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    {
      title: "发生了什么",
      key: "summary",
      render: (_, record) => {
        const href = objectHref(record);
        const object = `${objectLabel(record.objectType)}${
          record.objectId ? ` · ${record.objectId.slice(0, 8)}` : ""
        }`;
        return (
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{actionLabel(record.action)}</Typography.Text>
            {href ? (
              <Link href={href}>{object}</Link>
            ) : (
              <Typography.Text type="secondary">{object}</Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: "操作者",
      key: "operator",
      width: 190,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{record.operator?.displayName ?? "系统"}</Typography.Text>
          <Tag>
            {record.operatorRole ? (ROLE_LABELS[record.operatorRole] ?? "服务人员") : "系统"}
          </Tag>
        </Space>
      ),
    },
    {
      title: "原因或说明",
      dataIndex: "reason",
      render: (value) => value ?? "—",
    },
    {
      title: "详情",
      key: "detail",
      width: 90,
      render: (_, record) => <Button onClick={() => setSelected(record)}>查看</Button>,
    },
  ];

  return (
    <PermissionPage permission={PermissionCode.SYSTEM_AUDIT_READ}>
      <PageShell
        section="系统管理"
        title="审计日志"
        description="追踪登录、账号、学生、SOP、任务和逾期处理等关键操作。"
      >
        <FilterBar>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="全部操作"
            value={action || undefined}
            onChange={(value) => setAction(value ?? "")}
            options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))}
            style={{ width: 240 }}
          />
          <Select
            allowClear
            placeholder="全部对象"
            value={objectType || undefined}
            onChange={(value) => setObjectType(value ?? "")}
            options={Object.entries(OBJECT_LABELS).map(([value, label]) => ({ value, label }))}
            style={{ width: 180 }}
          />
          <Button onClick={() => void load(data.page, data.pageSize)}>刷新</Button>
          <Button
            disabled={!action && !objectType}
            onClick={() => {
              setAction("");
              setObjectType("");
            }}
          >
            清除筛选
          </Button>
        </FilterBar>
        {error ? (
          <ErrorState message={error} onRetry={() => void load(data.page, data.pageSize)} />
        ) : (
          <DataTable<AuditRecord>
            columns={columns}
            dataSource={data.items}
            loading={loading}
            pagination={{
              current: data.page,
              pageSize: data.pageSize,
              total: data.total,
              showSizeChanger: true,
              onChange: (page, pageSize) => void load(page, pageSize),
            }}
          />
        )}
        <Drawer
          open={Boolean(selected)}
          width={560}
          title={selected ? actionLabel(selected.action) : "审计详情"}
          onClose={() => setSelected(undefined)}
        >
          {selected ? (
            <Space direction="vertical" size={20} style={{ width: "100%" }}>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="时间">
                  {new Date(selected.createdAt).toLocaleString("zh-CN")}
                </Descriptions.Item>
                <Descriptions.Item label="操作者">
                  {selected.operator?.displayName ?? "系统"}
                  {selected.operator ? `（@${selected.operator.username}）` : ""}
                </Descriptions.Item>
                <Descriptions.Item label="角色">
                  {selected.operatorRole
                    ? (ROLE_LABELS[selected.operatorRole] ?? "服务人员")
                    : "系统"}
                </Descriptions.Item>
                <Descriptions.Item label="对象">
                  {objectLabel(selected.objectType)}
                  {selected.objectId ? ` · ${selected.objectId}` : ""}
                </Descriptions.Item>
                <Descriptions.Item label="原因">{selected.reason ?? "—"}</Descriptions.Item>
              </Descriptions>
              <div>
                <Typography.Title level={5}>变更前</Typography.Title>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                    borderRadius: 12,
                    background: "#f5f5f7",
                  }}
                >
                  {jsonText(selected.beforeData)}
                </pre>
              </div>
              <div>
                <Typography.Title level={5}>变更后</Typography.Title>
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                    borderRadius: 12,
                    background: "#f5f5f7",
                  }}
                >
                  {jsonText(selected.afterData)}
                </pre>
              </div>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Request ID">{selected.requestId}</Descriptions.Item>
                <Descriptions.Item label="IP">{selected.ipAddress ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="设备">{selected.deviceInfo ?? "—"}</Descriptions.Item>
              </Descriptions>
            </Space>
          ) : null}
        </Drawer>
      </PageShell>
    </PermissionPage>
  );
}
