"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { listIssues } from "../operations/operations-api";
import { createRectification, listRectifications } from "../rectifications/rectification-api";
import { listStudents } from "../students/student-api";
import { getButlerDashboard, getSupervisionSummary, listSupervisionTasks } from "../tasks/task-api";
import type {
  ButlerDashboard,
  ButlerDashboardItem,
  ButlerRiskLevel,
  SupervisionSummary,
} from "../tasks/task-types";

const ROLE_LABELS: Record<string, string> = {
  [RoleCode.ADMINISTRATOR]: "管理员",
  [RoleCode.ERIC_MANAGER]: "历史角色（已停用）",
  [RoleCode.BUTLER]: "管家",
  [RoleCode.PLANNER]: "规划老师",
  [RoleCode.SPECIALIST]: "专项老师",
  [RoleCode.STUDENT]: "学生",
};

const RISK: Record<ButlerRiskLevel, { label: string; color: string; order: number }> = {
  URGENT: { label: "紧急", color: "error", order: 3 },
  WARNING: { label: "警告", color: "warning", order: 2 },
  REMINDER: { label: "提醒", color: "processing", order: 1 },
  NORMAL: { label: "正常", color: "success", order: 0 },
};

interface BusinessTodo {
  key: string;
  type: "RECTIFICATION_REVIEW" | "PLANNER_ASSIGNMENT" | "SPECIALIST_ASSIGNMENT" | "ESCALATED_ISSUE";
  typeLabel: string;
  title: string;
  description: string;
  dueAt: string | null;
  updatedAt: string;
  href: string;
  actionLabel: string;
}

function hk(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ageSince(value: string) {
  const hours = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`;
}

function todoPriority(todo: BusinessTodo) {
  if (!todo.dueAt) return 3;
  const due = new Date(todo.dueAt);
  const now = new Date();
  if (due < now) return 0;
  if (due.toDateString() === now.toDateString()) return 1;
  return 2;
}

function AdminWorkspace() {
  const { message } = App.useApp();
  const [dashboard, setDashboard] = useState<ButlerDashboard>();
  const [supervision, setSupervision] = useState<SupervisionSummary>();
  const [plannerQueueTotal, setPlannerQueueTotal] = useState(0);
  const [pendingReviewTotal, setPendingReviewTotal] = useState(0);
  const [todos, setTodos] = useState<BusinessTodo[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [selectedButler, setSelectedButler] = useState<ButlerDashboardItem>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createForm] = Form.useForm<{
    selectedIds: string[];
    summary: string;
    dueAt: { toISOString(): string };
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [butlers, taskSummary, students, reviews, issues, unassignedTasks] = await Promise.all([
        getButlerDashboard(),
        getSupervisionSummary({ page: 1, pageSize: 100 }),
        listStudents({ page: 1, pageSize: 100 }),
        listRectifications({ status: "PENDING_REVIEW", pageSize: 100 }),
        listIssues({ status: "OPEN" }),
        listSupervisionTasks({ page: 1, pageSize: 100, unassigned: true }),
      ]);
      const plannerQueue = students.items.filter(
        (student) => student.serviceStatus === "ENABLED" && !student.planner,
      );
      setDashboard(butlers);
      setSupervision(taskSummary);
      setPlannerQueueTotal(plannerQueue.length);
      setPendingReviewTotal(reviews.total);
      const nextTodos: BusinessTodo[] = [
        ...reviews.items.map((record) => ({
          key: `review:${record.id}`,
          type: "RECTIFICATION_REVIEW" as const,
          typeLabel: "待复核整改",
          title: `${record.butler.displayName}已提交整改结果`,
          description: `${record.items.length} 项关联异常 · ${record.summary}`,
          dueAt: record.dueAt,
          updatedAt: record.updatedAt,
          href: "/workspace/butlers",
          actionLabel: "复核",
        })),
        ...plannerQueue.map((student) => ({
          key: `planner:${student.id}`,
          type: "PLANNER_ASSIGNMENT" as const,
          typeLabel: "待分配规划老师",
          title: `${student.name}待分配规划老师`,
          description: `${student.defaultButler?.displayName ?? "管家"}已开通学生账号和服务，可立即分配规划老师`,
          dueAt: null,
          updatedAt: student.updatedAt,
          href: `/workspace/students/${student.id}`,
          actionLabel: "分配老师",
        })),
        ...unassignedTasks.items
          .filter((task) => task.sourceType === "ISSUE" || task.sourceType === "APPLICATION")
          .map((task) => ({
            key: `assignment:${task.id}`,
            type: "SPECIALIST_ASSIGNMENT" as const,
            typeLabel: "待分配专项老师",
            title: task.title,
            description: `${task.student.name} · ${task.stage.name}`,
            dueAt: task.currentDueAt,
            updatedAt: task.updatedAt,
            href: `/workspace/tasks/${task.id}`,
            actionLabel: "分配老师",
          })),
        ...issues.items.map((issue) => ({
          key: `issue:${issue.id}`,
          type: "ESCALATED_ISSUE" as const,
          typeLabel: "升级待决策",
          title: `${issue.student.name} · ${issue.category}`,
          description: issue.description,
          dueAt: issue.dueAt,
          updatedAt: issue.updatedAt,
          href: `/workspace/issues?issueId=${issue.id}`,
          actionLabel: "处理",
        })),
      ];
      nextTodos.sort(
        (left, right) =>
          todoPriority(left) - todoPriority(right) ||
          new Date(left.dueAt ?? left.updatedAt).getTime() -
            new Date(right.dueAt ?? right.updatedAt).getTime(),
      );
      setTodos(nextTodos.slice(0, 5));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "管理员工作区数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const interventionButlers = useMemo(
    () =>
      (dashboard?.items ?? [])
        .filter((item) => item.riskLevel !== "NORMAL")
        .sort(
          (left, right) =>
            RISK[right.riskLevel].order - RISK[left.riskLevel].order ||
            right.attentionCount - left.attentionCount,
        )
        .slice(0, 5),
    [dashboard?.items],
  );

  return (
    <PageShell
      title="管理员工作区"
      description="只展示今天需要介入、决策或亲自完成的事项。"
      extra={
        <Link href="/workspace/students/new">
          <Button type="primary">新建学生</Button>
        </Link>
      }
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title="工作区暂时无法加载"
          description={error}
          action={<Button onClick={() => void load()}>重试</Button>}
          style={{ marginBottom: 16 }}
        />
      ) : null}
      {loading && !dashboard ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : dashboard && supervision ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            {[
              ["异常管家", dashboard.summary.abnormalButlerCount, "/workspace/butlers", "red"],
              ["逾期任务", supervision.overdue, "/workspace/butlers", "orange"],
              ["待复核整改", pendingReviewTotal, "/workspace/butlers", "cyan"],
              ["待分配规划老师", plannerQueueTotal, "/workspace/students", "blue"],
            ].map(([title, value, href, color]) => (
              <Col xs={12} xl={6} key={String(title)}>
                <Link href={String(href)} style={{ display: "block" }}>
                  <Card hoverable styles={{ body: { padding: 18 } }}>
                    <Statistic
                      title={String(title)}
                      value={Number(value)}
                      styles={{ content: { color: `var(--ant-${String(color)})` } }}
                    />
                  </Card>
                </Link>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]} align="stretch">
            <Col xs={24} xl={13}>
              <Card
                title="需要介入的管家"
                extra={<Link href="/workspace/butlers">查看全部</Link>}
                style={{ height: "100%" }}
              >
                {interventionButlers.length === 0 ? (
                  <Empty description="当前没有需要介入的管家" />
                ) : (
                  <Space orientation="vertical" size={0} style={{ width: "100%" }}>
                    {interventionButlers.map((butler) => (
                      <div
                        key={butler.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "minmax(110px, 0.7fr) minmax(230px, 1.6fr) auto",
                          gap: 16,
                          alignItems: "center",
                          padding: "14px 0",
                          borderBottom: "1px solid rgb(5 5 5 / 6%)",
                        }}
                      >
                        <Space orientation="vertical" size={4}>
                          <Typography.Text strong>{butler.displayName}</Typography.Text>
                          <Tag
                            color={RISK[butler.riskLevel].color}
                            style={{ width: "fit-content" }}
                          >
                            {RISK[butler.riskLevel].label}
                          </Tag>
                        </Space>
                        <Space orientation="vertical" size={4}>
                          <Typography.Text>
                            {butler.overdue > 0 ? `${butler.overdue} 项任务逾期` : ""}
                            {butler.overdue > 0 && butler.overdueIssueCount > 0 ? " · " : ""}
                            {butler.overdueIssueCount > 0
                              ? `${butler.overdueIssueCount} 个问题超时`
                              : ""}
                            {butler.riskLevel === "REMINDER" ? "任务将在 24 小时内到期" : ""}
                          </Typography.Text>
                          <Typography.Text type="secondary">
                            {butler.oldestOverdueAt
                              ? `最长逾期 ${ageSince(butler.oldestOverdueAt)}`
                              : "尚未逾期"}
                            {butler.affectedStudents.length > 0
                              ? ` · 影响 ${butler.affectedStudents.map((student) => student.name).join("、")}`
                              : ""}
                          </Typography.Text>
                          {butler.activeRectificationCount > 0 ? (
                            <Typography.Text type="secondary">
                              {butler.activeRectificationCount} 张整改单进行中
                            </Typography.Text>
                          ) : null}
                        </Space>
                        <Button type="link" onClick={() => setSelectedButler(butler)}>
                          查看异常
                        </Button>
                      </div>
                    ))}
                  </Space>
                )}
              </Card>
            </Col>

            <Col xs={24} xl={11}>
              <Card title="我的业务待办" style={{ height: "100%" }}>
                {todos.length === 0 ? (
                  <Empty description="当前没有需要管理员处理的业务待办" />
                ) : (
                  <Space orientation="vertical" size={0} style={{ width: "100%" }}>
                    {todos.map((todo) => {
                      const overdue = Boolean(todo.dueAt && new Date(todo.dueAt) < new Date());
                      return (
                        <div
                          key={todo.key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto",
                            gap: 12,
                            padding: "12px 0",
                            borderBottom: "1px solid rgb(5 5 5 / 6%)",
                          }}
                        >
                          <Space orientation="vertical" size={3}>
                            <Space wrap>
                              <Tag color={overdue ? "error" : "blue"}>{todo.typeLabel}</Tag>
                              {todo.dueAt ? (
                                <Typography.Text type={overdue ? "danger" : "secondary"}>
                                  {overdue ? "已逾期" : "截止"} {hk(todo.dueAt)}
                                </Typography.Text>
                              ) : null}
                            </Space>
                            <Typography.Text strong>{todo.title}</Typography.Text>
                            <Typography.Text type="secondary" ellipsis>
                              {todo.description}
                            </Typography.Text>
                          </Space>
                          <Link href={todo.href}>{todo.actionLabel}</Link>
                        </div>
                      );
                    })}
                  </Space>
                )}
              </Card>
            </Col>
          </Row>
        </Space>
      ) : null}

      <Drawer
        title={selectedButler ? `${selectedButler.displayName}的异常明细` : "异常明细"}
        size={620}
        open={Boolean(selectedButler)}
        onClose={() => setSelectedButler(undefined)}
        extra={
          <Button
            type="primary"
            disabled={!selectedButler?.anomalies.length}
            onClick={() => {
              if (!selectedButler) return;
              createForm.setFieldsValue({
                selectedIds: selectedButler.anomalies.map((item) => `${item.type}:${item.id}`),
                summary: `请对 ${selectedButler.anomalies.length} 项逾期事项完成整改并说明原因。`,
              });
              setCreateOpen(true);
            }}
          >
            发起整改
          </Button>
        }
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type={selectedButler?.riskLevel === "URGENT" ? "error" : "warning"}
            showIcon
            title={`${selectedButler?.anomalies.length ?? 0} 项可核验异常`}
            description="这里只依据明确截止时间判断，不使用消息回复或人工进度百分比。"
          />
          {selectedButler?.anomalies.map((item) => (
            <Card key={`${item.type}:${item.id}`} size="small">
              <Space orientation="vertical" size={4}>
                <Space wrap>
                  <Tag color={item.type === "TASK" ? "error" : "volcano"}>
                    {item.type === "TASK" ? "逾期任务" : "超时问题"}
                  </Tag>
                  {item.isBlocking ? <Tag color="magenta">阻塞任务</Tag> : null}
                </Space>
                <Typography.Text strong>{item.title}</Typography.Text>
                <Typography.Text type="secondary">
                  {item.student.name} · 截止 {hk(item.dueAt)} · 已逾期 {ageSince(item.dueAt)}
                </Typography.Text>
              </Space>
            </Card>
          ))}
        </Space>
      </Drawer>

      <Modal
        title="发起整改"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建整改单"
        confirmLoading={creating}
        onOk={() => createForm.submit()}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={async (values) => {
            if (!selectedButler) return;
            setCreating(true);
            try {
              await createRectification({
                butlerId: selectedButler.id,
                taskIds: values.selectedIds
                  .filter((value) => value.startsWith("TASK:"))
                  .map((value) => value.slice(5)),
                issueIds: values.selectedIds
                  .filter((value) => value.startsWith("ISSUE:"))
                  .map((value) => value.slice(6)),
                summary: values.summary,
                dueAt: values.dueAt.toISOString(),
              });
              await message.success("整改单已创建");
              setCreateOpen(false);
              setSelectedButler(undefined);
              await load();
            } catch (exception) {
              await message.error(exception instanceof Error ? exception.message : "创建失败");
            } finally {
              setCreating(false);
            }
          }}
        >
          <Form.Item
            name="selectedIds"
            label="关联异常"
            rules={[{ required: true, message: "至少选择一项异常" }]}
          >
            <Checkbox.Group
              style={{ display: "grid", gap: 8 }}
              options={(selectedButler?.anomalies ?? []).map((item) => ({
                value: `${item.type}:${item.id}`,
                label: `${item.student.name} · ${item.title}`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="summary"
            label="整改要求"
            rules={[{ required: true, whitespace: true, message: "请填写整改要求" }]}
          >
            <Input.TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item
            name="dueAt"
            label="整改截止时间"
            rules={[{ required: true, message: "请选择整改截止时间" }]}
          >
            <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
    </PageShell>
  );
}

function RoleWorkspace() {
  const { user } = useAuth();
  if (!user) return <Skeleton active paragraph={{ rows: 5 }} />;
  const roleDescription = user.roles.includes(RoleCode.BUTLER)
    ? "请从“我的任务”安排日常工作，并在学生管理中查看本人负责学生的服务进度。"
    : user.roles.includes(RoleCode.PLANNER)
      ? "请在学生管理中查看本人负责的学生，并维护学情和升学目标。"
      : user.roles.includes(RoleCode.SPECIALIST)
        ? "请从“我的任务”查看和处理分配给你的专项工作。"
        : "当前角色暂未配置独立业务入口，请联系管理员确认账号权限。";
  return (
    <PageShell title="工作区" description="根据当前角色展示可使用的业务范围。">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="当前账号">
            <Typography.Title level={4}>{user.displayName}</Typography.Title>
            <Typography.Paragraph type="secondary">@{user.username}</Typography.Paragraph>
            {user.roles.map((role) => (
              <Tag key={role}>{ROLE_LABELS[role] ?? role}</Tag>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="工作提示">
            <Alert type="info" showIcon title="V1.0 服务协同工作区" description={roleDescription} />
          </Card>
        </Col>
      </Row>
    </PageShell>
  );
}

export function WorkspaceHome() {
  const { user } = useAuth();
  if (!user) return <Skeleton active paragraph={{ rows: 5 }} />;
  const hasAdminOverview =
    user.roles.includes(RoleCode.ADMINISTRATOR) &&
    user.permissions.includes(PermissionCode.TASK_SUPERVISION_READ);
  return hasAdminOverview ? <AdminWorkspace /> : <RoleWorkspace />;
}
