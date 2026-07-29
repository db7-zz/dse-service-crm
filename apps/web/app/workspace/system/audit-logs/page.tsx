"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionCode } from "@dse/shared";
import { Button, Input, type TableColumnsType } from "antd";
import { DataTable, ErrorState, FilterBar } from "@dse/ui";
import { PermissionPage } from "../../../../src/auth/permission-page";
import { apiClient } from "../../../../src/auth/api";
import { PageShell } from "../../../../src/layout/page-shell";

interface AuditRecord {
  id: string;
  operatorId: string | null;
  operatorRole: string | null;
  objectType: string;
  objectId: string | null;
  action: string;
  reason: string | null;
  requestId: string;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditRecord[];
  page: number;
  pageSize: number;
  total: number;
}

export default function AuditLogsPage() {
  const [data, setData] = useState<AuditPage>({ items: [], page: 1, pageSize: 20, total: 0 });
  const [action, setAction] = useState("");
  const [objectType, setObjectType] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (page = data.page, pageSize = data.pageSize) => {
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
    [action, data.page, data.pageSize, objectType],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const columns: TableColumnsType<AuditRecord> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 190,
      render: (value: string) => new Date(value).toLocaleString("zh-CN"),
    },
    { title: "操作", dataIndex: "action", width: 180 },
    {
      title: "操作者角色",
      dataIndex: "operatorRole",
      width: 150,
      render: (value) => value ?? "系统",
    },
    {
      title: "对象",
      key: "object",
      render: (_, record) =>
        `${record.objectType}${record.objectId ? ` / ${record.objectId}` : ""}`,
    },
    { title: "原因", dataIndex: "reason", render: (value) => value ?? "—" },
    { title: "Request ID", dataIndex: "requestId", width: 250 },
    { title: "IP", dataIndex: "ipAddress", width: 140, render: (value) => value ?? "—" },
  ];

  return (
    <PermissionPage permission={PermissionCode.SYSTEM_AUDIT_READ}>
      <PageShell
        section="系统管理"
        title="审计日志"
        description="登录、账号、角色和权限敏感操作的结构化追踪记录。"
      >
        <FilterBar>
          <Input
            allowClear
            placeholder="操作类型，例如 LOGIN_SUCCESS"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            style={{ width: 260 }}
          />
          <Input
            allowClear
            placeholder="对象类型，例如 user"
            value={objectType}
            onChange={(event) => setObjectType(event.target.value)}
            style={{ width: 220 }}
          />
          <Button onClick={() => void load(1)}>查询</Button>
        </FilterBar>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
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
      </PageShell>
    </PermissionPage>
  );
}
