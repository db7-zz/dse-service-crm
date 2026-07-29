"use client";

import { useCallback, useEffect, useState } from "react";
import { PermissionCode, RoleCode } from "@dse/shared";
import { Button, Form, Input, Select, Space, Typography, App, type TableColumnsType } from "antd";
import {
  DataTable,
  ErrorState,
  FilterBar,
  FormModal,
  SearchInput,
  StatusTag,
  confirmAction,
} from "@dse/ui";
import { PermissionPage } from "../../../../src/auth/permission-page";
import { apiClient } from "../../../../src/auth/api";
import { PageShell } from "../../../../src/layout/page-shell";

interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED" | "LOCKED";
  roles: Array<{ code: string; name: string }>;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UserPage {
  items: UserRecord[];
  page: number;
  pageSize: number;
  total: number;
}

const ROLE_OPTIONS = [
  { value: RoleCode.ADMINISTRATOR, label: "管理员" },
  { value: RoleCode.ERIC_MANAGER, label: "业务负责人" },
  { value: RoleCode.BUTLER, label: "管家" },
  { value: RoleCode.PLANNER, label: "规划老师" },
  { value: RoleCode.SPECIALIST, label: "专项老师" },
  { value: RoleCode.STUDENT, label: "学生" },
];

export default function UsersPage() {
  const [data, setData] = useState<UserPage>({ items: [], page: 1, pageSize: 20, total: 0 });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [roleUser, setRoleUser] = useState<UserRecord>();
  const [submitting, setSubmitting] = useState(false);
  const [createForm] = Form.useForm();
  const [roleForm] = Form.useForm();
  const { message } = App.useApp();

  const load = useCallback(
    async (page = data.page, pageSize = data.pageSize) => {
      setLoading(true);
      setError(undefined);
      try {
        const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
        if (search) query.set("search", search);
        if (status) query.set("status", status);
        setData(await apiClient.request<UserPage>(`/admin/users?${query.toString()}`));
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "账号列表加载失败");
      } finally {
        setLoading(false);
      }
    },
    [data.page, data.pageSize, search, status],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const changeState = async (record: UserRecord, action: "enable" | "disable") => {
    await apiClient.request(`/admin/users/${record.id}/${action}`, {
      method: "POST",
      body: JSON.stringify({
        reason: `管理员在账号管理页面执行${action === "enable" ? "启用" : "停用"}`,
      }),
    });
    await message.success(action === "enable" ? "账号已启用" : "账号已停用");
    await load();
  };

  const columns: TableColumnsType<UserRecord> = [
    {
      title: "姓名",
      dataIndex: "displayName",
      render: (value: string, record) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <br />
          <Typography.Text type="secondary">@{record.username}</Typography.Text>
        </div>
      ),
    },
    {
      title: "角色",
      dataIndex: "roles",
      render: (roles: UserRecord["roles"]) => roles.map((role) => role.name).join("、"),
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 110,
      render: (value: UserRecord["status"]) => (
        <StatusTag
          status={value}
          label={{ ACTIVE: "启用", DISABLED: "停用", LOCKED: "临时锁定" }[value]}
        />
      ),
    },
    {
      title: "最后登录",
      dataIndex: "lastLoginAt",
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString("zh-CN") : "尚未登录",
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            onClick={() => {
              setRoleUser(record);
              roleForm.setFieldsValue({
                roleCodes: record.roles.map((role) => role.code),
                reason: "",
              });
            }}
          >
            调整角色
          </Button>
          <Button
            size="small"
            danger={record.status === "ACTIVE"}
            onClick={() =>
              confirmAction({
                title: record.status === "DISABLED" ? "启用账号" : "停用账号",
                content:
                  record.status === "DISABLED"
                    ? `确认启用 ${record.displayName}？`
                    : `停用后将立即撤销 ${record.displayName} 的全部会话。`,
                danger: record.status === "ACTIVE",
                onConfirm: () =>
                  changeState(record, record.status === "DISABLED" ? "enable" : "disable"),
              })
            }
          >
            {record.status === "DISABLED" ? "启用" : "停用"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <PermissionPage permission={PermissionCode.SYSTEM_USERS_READ}>
      <PageShell
        section="系统管理"
        title="账号管理"
        description="创建、启停人员账号并维护角色。敏感操作会撤销会话并写入审计日志。"
        extra={
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建账号
          </Button>
        }
      >
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onPressEnter={() => void load(1)}
          />
          <Select
            allowClear
            placeholder="全部状态"
            value={status}
            onChange={setStatus}
            style={{ width: 150 }}
            options={[
              { value: "ACTIVE", label: "启用" },
              { value: "DISABLED", label: "停用" },
              { value: "LOCKED", label: "临时锁定" },
            ]}
          />
          <Button onClick={() => void load(1)}>查询</Button>
        </FilterBar>
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : (
          <DataTable<UserRecord>
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

        <FormModal
          title="新建账号"
          open={createOpen}
          submitting={submitting}
          onCancel={() => setCreateOpen(false)}
          onOk={() => createForm.submit()}
        >
          <Form
            form={createForm}
            layout="vertical"
            onFinish={async (values) => {
              setSubmitting(true);
              try {
                await apiClient.request("/admin/users", {
                  method: "POST",
                  body: JSON.stringify(values),
                });
                await message.success("账号创建成功");
                setCreateOpen(false);
                createForm.resetFields();
                await load(1);
              } catch (exception) {
                await message.error(
                  exception instanceof Error ? exception.message : "账号创建失败",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              label="登录账号"
              name="username"
              rules={[
                { required: true, message: "请输入登录账号" },
                { pattern: /^[A-Za-z0-9._-]{3,64}$/, message: "账号格式不正确" },
              ]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="姓名"
              name="displayName"
              rules={[{ required: true, message: "请输入姓名" }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              label="初始密码"
              name="password"
              rules={[
                { required: true, message: "请输入初始密码" },
                { min: 6, message: "密码不少于6位" },
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              label="角色"
              name="roleCodes"
              rules={[{ required: true, message: "请选择至少一个角色" }]}
            >
              <Select mode="multiple" options={ROLE_OPTIONS} />
            </Form.Item>
          </Form>
        </FormModal>

        <FormModal
          title={`调整角色 · ${roleUser?.displayName ?? ""}`}
          open={Boolean(roleUser)}
          submitting={submitting}
          onCancel={() => setRoleUser(undefined)}
          onOk={() => roleForm.submit()}
        >
          <Form
            form={roleForm}
            layout="vertical"
            onFinish={async (values) => {
              if (!roleUser) return;
              setSubmitting(true);
              try {
                await apiClient.request(`/admin/users/${roleUser.id}/roles`, {
                  method: "PUT",
                  body: JSON.stringify(values),
                });
                await message.success("角色已更新，请相关用户重新登录");
                setRoleUser(undefined);
                await load();
              } catch (exception) {
                await message.error(
                  exception instanceof Error ? exception.message : "角色更新失败",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              label="角色"
              name="roleCodes"
              rules={[{ required: true, message: "请选择至少一个角色" }]}
            >
              <Select mode="multiple" options={ROLE_OPTIONS} />
            </Form.Item>
            <Form.Item
              label="变更原因"
              name="reason"
              rules={[{ required: true, message: "请填写变更原因" }]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          </Form>
        </FormModal>
      </PageShell>
    </PermissionPage>
  );
}
