"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
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
  Typography,
  message,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { getResponsiblePersonOptions, listStudents } from "../students/student-api";
import type { ResponsiblePersonOption, StudentRecord } from "../students/student-types";
import { createIssue, issueAction, listIssues } from "./operations-api";
import type { IssueView } from "./operations-types";

const STATUS_LABELS: Record<string, string> = {
  OPEN: "待处理",
  NEEDS_INFO: "待补充",
  RESPONDED: "已回复",
  CONVERTED_TO_TASK: "已转专项任务",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

export function IssuesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<IssueView[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [specialists, setSpecialists] = useState<ResponsiblePersonOption[]>([]);
  const [selected, setSelected] = useState<IssueView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [createForm] = Form.useForm();
  const [convertForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const canWrite = Boolean(user?.permissions.includes(PermissionCode.ISSUES_WRITE));
  const canManage = Boolean(user?.permissions.includes(PermissionCode.ISSUES_MANAGE));
  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listIssues({});
      setItems(result.items);
      const requestedId = new URLSearchParams(window.location.search).get("issueId");
      setSelected((current) => {
        const targetId = current?.id ?? requestedId;
        return targetId ? (result.items.find((item) => item.id === targetId) ?? null) : null;
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "问题列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void Promise.all([listStudents({ pageSize: 100, mine }), getResponsiblePersonOptions()])
      .then(([studentPage, people]) => {
        setStudents(studentPage.items);
        setSpecialists(people.specialists ?? []);
      })
      .catch(() => undefined);
    void refresh();
  }, [mine, refresh]);

  const quickAction = (action: "respond" | "resolve" | "close" | "reopen") => {
    if (!selected) return;
    const note = window.prompt(action === "respond" ? "请输入给提交人的回复" : "请输入处理说明");
    if (!note) return;
    void issueAction(selected.id, action, {
      note,
      version: selected.version,
      ...(action === "respond" ? { requestMoreInformation: false } : {}),
    })
      .then(() => refresh())
      .then(() => messageApi.success("问题状态已更新"))
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "操作失败"),
      );
  };

  return (
    <PermissionPage permission={PermissionCode.ISSUES_READ}>
      {contextHolder}
      <PageShell
        title="问题协同"
        description="管家提交卡点，管理员回复或转化为专项老师任务，并保留完整处理轨迹。"
        extra={
          canWrite ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              提交问题
            </Button>
          ) : null
        }
      >
        <Table<IssueView>
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: <Empty description="暂无问题" /> }}
          onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: "pointer" } })}
          scroll={{ x: 900 }}
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
            { title: "分类", dataIndex: "category", width: 130 },
            { title: "问题", dataIndex: "description", ellipsis: true },
            {
              title: "优先级",
              dataIndex: "priority",
              width: 100,
              render: (value: string | null) =>
                value ? <Tag color={value === "HIGH" ? "error" : "warning"}>{value}</Tag> : "—",
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 130,
              render: (value: string) => (
                <Tag
                  color={
                    value === "RESOLVED" || value === "CLOSED"
                      ? "success"
                      : value === "NEEDS_INFO"
                        ? "warning"
                        : "processing"
                  }
                >
                  {STATUS_LABELS[value] ?? value}
                </Tag>
              ),
            },
            {
              title: "负责人",
              dataIndex: "owner",
              width: 110,
              render: (value: IssueView["owner"]) => value?.displayName ?? "待分配",
            },
            {
              title: "处理截止",
              dataIndex: "dueAt",
              width: 180,
              render: (value: string | null, item) =>
                value ? (
                  <Typography.Text type={item.isOverdue ? "danger" : undefined}>
                    {new Date(value).toLocaleString("zh-CN")}
                  </Typography.Text>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </PageShell>
      <Drawer
        title={selected ? `${selected.student.name} · ${selected.category}` : "问题详情"}
        width={640}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        extra={
          selected ? (
            <Space wrap>
              {canManage && !["RESOLVED", "CLOSED"].includes(selected.status) ? (
                <Button onClick={() => quickAction("respond")}>回复</Button>
              ) : null}
              {canManage &&
              !selected.convertedTask &&
              !["RESOLVED", "CLOSED"].includes(selected.status) ? (
                <Button type="primary" onClick={() => setConvertOpen(true)}>
                  转专项任务
                </Button>
              ) : null}
              {canManage && !["RESOLVED", "CLOSED"].includes(selected.status) ? (
                <Button onClick={() => quickAction("resolve")}>标记解决</Button>
              ) : null}
              {canWrite && ["RESOLVED", "CLOSED"].includes(selected.status) ? (
                <Button onClick={() => quickAction("reopen")}>重新打开</Button>
              ) : null}
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
                  key: "status",
                  label: "状态",
                  children: STATUS_LABELS[selected.status] ?? selected.status,
                },
                { key: "description", label: "问题描述", children: selected.description },
                { key: "context", label: "背景与已尝试方案", children: selected.context },
                {
                  key: "owner",
                  label: "负责人",
                  children: selected.owner?.displayName ?? "待分配",
                },
                {
                  key: "dueAt",
                  label: "处理截止",
                  children: selected.dueAt ? new Date(selected.dueAt).toLocaleString("zh-CN") : "—",
                },
                { key: "response", label: "管理员回复", children: selected.managerResponse ?? "—" },
                {
                  key: "task",
                  label: "专项任务",
                  children: selected.convertedTask ? (
                    <Link href={`/workspace/tasks/${selected.convertedTask.id}`}>
                      {selected.convertedTask.title}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
            <section>
              <h3>处理轨迹</h3>
              <Timeline
                items={selected.logs.map((log) => ({
                  children: (
                    <>
                      <strong>{log.action}</strong>
                      <div>{log.note ?? "—"}</div>
                      <small>
                        {log.operator.displayName} ·{" "}
                        {new Date(log.createdAt).toLocaleString("zh-CN")}
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
        title="提交问题"
        open={createOpen}
        okText="提交"
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void createForm
            .validateFields()
            .then(async (values: object) => {
              await createIssue(values);
              setCreateOpen(false);
              createForm.resetFields();
              await refresh();
              messageApi.success("问题已提交");
            })
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
          <Form.Item name="category" label="问题分类" rules={[{ required: true }]}>
            <Select
              options={["APPLICATION", "MATERIAL", "PLANNING", "SYSTEM", "OTHER"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="description" label="问题描述" rules={[{ required: true, max: 2000 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item
            name="context"
            label="背景与已尝试方案"
            rules={[{ required: true, max: 4000 }]}
          >
            <Input.TextArea rows={5} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select
              allowClear
              options={[
                { value: "NORMAL", label: "普通" },
                { value: "HIGH", label: "高" },
                { value: "URGENT", label: "紧急" },
              ]}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            title="系统会自动指定管理员负责人和处理截止时间"
            description="普通问题默认 72 小时，高优先级 48 小时，紧急问题 24 小时。"
          />
        </Form>
      </Modal>
      <Modal
        title="转为专项任务"
        open={convertOpen}
        okText="创建并分配"
        onCancel={() => setConvertOpen(false)}
        onOk={() =>
          void convertForm
            .validateFields()
            .then(
              async (values: {
                ownerId: string;
                dueAt: string;
                note: string;
                evidenceRequired?: boolean;
              }) => {
                if (!selected) return;
                await issueAction(selected.id, "convert-to-task", {
                  ...values,
                  dueAt: new Date(values.dueAt).toISOString(),
                  version: selected.version,
                });
                setConvertOpen(false);
                convertForm.resetFields();
                await refresh();
                messageApi.success("专项任务已创建");
              },
            )
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form form={convertForm} layout="vertical">
          <Form.Item name="ownerId" label="专项老师" rules={[{ required: true }]}>
            <Select
              options={specialists.map((person) => ({
                value: person.id,
                label: person.displayName,
              }))}
            />
          </Form.Item>
          <Form.Item name="dueAt" label="截止时间" rules={[{ required: true }]}>
            <Input type="datetime-local" />
          </Form.Item>
          <Form.Item
            name="note"
            label="完成标准 / 处理说明"
            rules={[{ required: true, max: 4000 }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </PermissionPage>
  );
}
