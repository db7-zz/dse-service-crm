"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  message,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { listStudents } from "../students/student-api";
import type { StudentRecord } from "../students/student-types";
import {
  changeApplicationStatus,
  createApplication,
  createApplicationRequirement,
  listApplications,
} from "./operations-api";
import type { ApplicationView } from "./operations-types";

const STATUSES = [
  "PLANNING",
  "CONFIRMED",
  "MATERIAL_PREPARATION",
  "PENDING_SUBMISSION",
  "SUBMITTED",
  "WAITING_RESULT",
  "SUPPLEMENT",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "ENROLLED",
  "WITHDRAWN",
];
const STATUS_LABELS: Record<string, string> = {
  PLANNING: "规划中",
  CONFIRMED: "已确认",
  MATERIAL_PREPARATION: "材料准备",
  PENDING_SUBMISSION: "待递交",
  SUBMITTED: "已递交",
  WAITING_RESULT: "等待结果",
  SUPPLEMENT: "补件",
  INTERVIEW: "面试",
  OFFER: "已获录取",
  REJECTED: "未录取",
  ENROLLED: "已入读",
  WITHDRAWN: "已撤回",
};

export function ApplicationsPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ApplicationView[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentFilter, setStudentFilter] = useState<string>();
  const [selected, setSelected] = useState<ApplicationView | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [createForm] = Form.useForm();
  const [statusForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const canWrite = Boolean(user?.permissions.includes(PermissionCode.APPLICATIONS_WRITE));
  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listApplications({ studentId: studentFilter });
      setItems(result.items);
      const requestedId = new URLSearchParams(window.location.search).get("applicationId");
      setSelected((current) => {
        const targetId = current?.id ?? requestedId;
        return targetId ? (result.items.find((item) => item.id === targetId) ?? null) : null;
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "申请记录加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, studentFilter]);

  useEffect(() => {
    const requestedStudentId = new URLSearchParams(window.location.search).get("studentId");
    if (requestedStudentId) setStudentFilter(requestedStudentId);
    void listStudents({ pageSize: 100, mine }).then((result) => setStudents(result.items));
  }, [mine]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PermissionPage permission={PermissionCode.APPLICATIONS_READ}>
      {contextHolder}
      <PageShell
        title="申请管理"
        description="统一跟进香港院校直申与 JUPAS 的递交、补件、面试和录取状态。"
        extra={
          canWrite ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新增申请
            </Button>
          ) : null
        }
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="筛选学生"
            value={studentFilter}
            style={{ width: "min(100%, 420px)" }}
            options={students.map((student) => ({
              value: student.id,
              label: `${student.name} · ${student.studentNo}`,
            }))}
            onChange={setStudentFilter}
          />
          <Table<ApplicationView>
            rowKey="id"
            loading={loading}
            dataSource={items}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            locale={{ emptyText: <Empty description="暂无申请记录" /> }}
            onRow={(record) => ({
              onClick: () => setSelected(record),
              style: { cursor: "pointer" },
            })}
            scroll={{ x: 980 }}
            columns={[
              {
                title: "学生",
                render: (_value, item) => (
                  <Space direction="vertical" size={0}>
                    <strong>{item.student.name}</strong>
                    <span style={{ color: "#64748b" }}>{item.student.studentNo}</span>
                  </Space>
                ),
              },
              {
                title: "渠道",
                dataIndex: "channel",
                width: 100,
                render: (value: string) => (value === "JUPAS" ? "JUPAS" : "港校直申"),
              },
              {
                title: "院校 / 专业",
                render: (_value, item) => (
                  <Space direction="vertical" size={0}>
                    <strong>{item.institutionName}</strong>
                    <span>{item.programName ?? "未填写专业"}</span>
                  </Space>
                ),
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 120,
                render: (value: string, item) => (
                  <Tag
                    color={
                      item.isOverdue
                        ? "error"
                        : value === "OFFER" || value === "ENROLLED"
                          ? "success"
                          : "processing"
                    }
                  >
                    {STATUS_LABELS[value] ?? value}
                  </Tag>
                ),
              },
              {
                title: "截止时间",
                dataIndex: "deadlineAt",
                width: 180,
                render: (value: string | null, item) => (
                  <span style={{ color: item.isOverdue ? "#dc2626" : undefined }}>
                    {value ? new Date(value).toLocaleString("zh-CN") : "—"}
                  </span>
                ),
              },
              {
                title: "负责人",
                dataIndex: "owner",
                width: 110,
                render: (value: ApplicationView["owner"]) => value?.displayName ?? "未分配",
              },
              {
                title: "待办",
                width: 80,
                render: (_value, item) =>
                  item.requirements.filter((entry) => entry.status === "OPEN").length,
              },
            ]}
          />
        </Space>
      </PageShell>
      <Drawer
        title={
          selected
            ? `${selected.institutionName} · ${selected.programName ?? "申请详情"}`
            : "申请详情"
        }
        width={640}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        extra={
          canWrite && selected ? (
            <Space>
              <Button
                onClick={() => {
                  const description = window.prompt("请输入节点待办说明");
                  if (!description) return;
                  const dueAt = window.prompt("请输入截止时间（例如 2026-09-01T18:00:00+08:00）");
                  if (!dueAt) return;
                  void createApplicationRequirement(selected.id, {
                    requirementType: "OTHER",
                    description,
                    dueAt: new Date(dueAt).toISOString(),
                    createTask: true,
                    isBlocking: true,
                  })
                    .then(() => refresh())
                    .catch((error: unknown) =>
                      messageApi.error(error instanceof Error ? error.message : "创建失败"),
                    );
                }}
              >
                新增节点待办
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  statusForm.setFieldsValue({ status: selected.status });
                  setStatusOpen(true);
                }}
              >
                更新状态
              </Button>
            </Space>
          ) : null
        }
      >
        {selected ? (
          <Space direction="vertical" size={24} style={{ width: "100%" }}>
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                {
                  key: "student",
                  label: "学生",
                  children: (
                    <Link href={`/workspace/students/${selected.student.id}`}>
                      {selected.student.name}
                    </Link>
                  ),
                },
                {
                  key: "status",
                  label: "当前状态",
                  children: STATUS_LABELS[selected.status] ?? selected.status,
                },
                { key: "no", label: "申请编号", children: selected.applicationNo ?? "—" },
                { key: "result", label: "结果", children: selected.result ?? "—" },
                { key: "offer", label: "录取条件", children: selected.offerCondition ?? "—" },
              ]}
            />
            <section>
              <h3>节点待办</h3>
              {selected.requirements.length ? (
                selected.requirements.map((entry) => (
                  <div
                    key={entry.id}
                    style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}
                  >
                    <Tag>{entry.status}</Tag>
                    {entry.description}
                    {entry.linkedTask ? (
                      <span>
                        {" "}
                        ·{" "}
                        <Link href={`/workspace/tasks/${entry.linkedTask.id}`}>
                          {entry.linkedTask.title}
                        </Link>
                      </span>
                    ) : null}
                  </div>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点待办" />
              )}
            </section>
            <section>
              <h3>状态时间线</h3>
              <Timeline
                items={selected.statusLogs.map((log) => ({
                  children: (
                    <>
                      <strong>{STATUS_LABELS[log.toStatus] ?? log.toStatus}</strong>
                      <div>{log.note}</div>
                      <small>
                        {log.operator.displayName} ·{" "}
                        {new Date(log.changedAt).toLocaleString("zh-CN")}
                      </small>
                    </>
                  ),
                }))}
              />
            </section>
          </Space>
        ) : null}
      </Drawer>
      <Modal
        title="新增申请"
        open={createOpen}
        okText="创建"
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void createForm
            .validateFields()
            .then(
              async (values: {
                studentId: string;
                channel: string;
                institutionName: string;
                programName?: string;
                deadlineAt?: string;
              }) => {
                await createApplication({
                  ...values,
                  deadlineAt: values.deadlineAt ? new Date(values.deadlineAt).toISOString() : null,
                });
                setCreateOpen(false);
                createForm.resetFields();
                await refresh();
                messageApi.success("申请已创建");
              },
            )
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="studentId" label="学生" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={students.map((student) => ({
                value: student.id,
                label: `${student.name} · ${student.studentNo}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="channel" label="渠道" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "HK_DIRECT", label: "港校直申" },
                { value: "JUPAS", label: "JUPAS" },
              ]}
            />
          </Form.Item>
          <Form.Item name="institutionName" label="院校" rules={[{ required: true, max: 200 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="programName" label="专业">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="deadlineAt" label="截止时间">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="更新申请状态"
        open={statusOpen}
        okText="确认更新"
        onCancel={() => setStatusOpen(false)}
        onOk={() =>
          void statusForm
            .validateFields()
            .then(
              async (values: {
                status: string;
                note: string;
                applicationNo?: string;
                result?: string;
                submittedAt?: string;
                confirmationDeadline?: string;
              }) => {
                if (!selected) return;
                await changeApplicationStatus(selected.id, {
                  ...values,
                  submittedAt: values.submittedAt
                    ? new Date(values.submittedAt).toISOString()
                    : undefined,
                  confirmationDeadline: values.confirmationDeadline
                    ? new Date(values.confirmationDeadline).toISOString()
                    : undefined,
                  version: selected.version,
                });
                setStatusOpen(false);
                await refresh();
                messageApi.success("申请状态已更新");
              },
            )
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form form={statusForm} layout="vertical">
          <Form.Item name="status" label="新状态" rules={[{ required: true }]}>
            <Select
              options={STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
            />
          </Form.Item>
          <Form.Item name="note" label="变更说明" rules={[{ required: true, max: 1000 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="applicationNo" label="申请编号">
            <Input />
          </Form.Item>
          <Form.Item name="submittedAt" label="实际递交时间（标记已递交时必填）">
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item name="result" label="结果摘要">
            <Input />
          </Form.Item>
          <Form.Item name="confirmationDeadline" label="录取确认截止时间">
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>
    </PermissionPage>
  );
}
