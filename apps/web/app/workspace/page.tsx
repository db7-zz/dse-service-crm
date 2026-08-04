"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Skeleton,
  Space,
  Statistic,
  Tag,
  Typography,
} from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { useAuth } from "../../src/auth/auth-context";
import { PageShell } from "../../src/layout/page-shell";
import {
  listApplications,
  listIssues,
  listNotifications,
} from "../../src/operations/operations-api";
import { listStudents } from "../../src/students/student-api";
import type { StudentRecord } from "../../src/students/student-types";
import { getSupervisionSummary } from "../../src/tasks/task-api";
import type { SupervisionSummary } from "../../src/tasks/task-types";

const ROLE_LABELS: Record<string, string> = {
  [RoleCode.ADMINISTRATOR]: "管理员",
  [RoleCode.ERIC_MANAGER]: "历史角色（已停用）",
  [RoleCode.BUTLER]: "管家",
  [RoleCode.PLANNER]: "规划老师",
  [RoleCode.SPECIALIST]: "专项老师",
  [RoleCode.STUDENT]: "学生",
};

interface AdminOverviewData {
  supervision: SupervisionSummary;
  students: StudentRecord[];
  studentTotal: number;
  applicationTotal: number;
  openIssueTotal: number;
  unreadNotificationTotal: number;
}

function AdminWorkspace() {
  const [data, setData] = useState<AdminOverviewData>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    Promise.all([
      getSupervisionSummary({ page: 1, pageSize: 20 }),
      listStudents({ page: 1, pageSize: 5 }),
      listApplications({}),
      listIssues({ status: "OPEN" }),
      listNotifications(true),
    ])
      .then(([supervision, students, applications, issues, notifications]) => {
        if (!active) return;
        setData({
          supervision,
          students: students.items,
          studentTotal: students.total,
          applicationTotal: applications.total,
          openIssueTotal: issues.total,
          unreadNotificationTotal: notifications.unreadCount,
        });
      })
      .catch((exception: unknown) => {
        if (!active) return;
        setError(exception instanceof Error ? exception.message : "工作区数据加载失败");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PageShell
      title="工作区"
      description="汇总学生服务、任务风险和待处理事项；监督看板保留为独立的任务监督页面。"
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
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!data && !error ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : data ? (
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <Row gutter={[16, 16]}>
            {[
              ["在册学生", data.studentTotal, "/workspace/students", "blue"],
              ["执行中任务", data.supervision.inProgress, "/workspace/supervision", "cyan"],
              ["逾期任务", data.supervision.overdue, "/workspace/supervision", "red"],
              ["待处理问题", data.openIssueTotal, "/workspace/issues", "orange"],
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

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={15}>
              <Card
                title="服务学生"
                extra={<Link href="/workspace/students">查看全部</Link>}
                style={{ height: "100%" }}
              >
                {data.students.length === 0 ? (
                  <Empty description="暂无学生" />
                ) : (
                  <div>
                    {data.students.map((student) => (
                      <div
                        key={student.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 16,
                          padding: "14px 0",
                          borderBottom: "1px solid rgb(5 5 5 / 6%)",
                        }}
                      >
                        <div>
                          <Space wrap>
                            <strong>{student.name}</strong>
                            <Tag>{student.studentNo}</Tag>
                            {student.riskLevel && student.riskLevel !== "NORMAL" ? (
                              <Tag color="warning">需要关注</Tag>
                            ) : null}
                          </Space>
                          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
                            {student.school ?? "学校待补充"} · {student.grade ?? "年级待补充"} ·
                            管家：{student.defaultButler?.displayName ?? "待分配"}
                          </Typography.Paragraph>
                        </div>
                        <Link href={`/workspace/students/${student.id}`}>查看详情</Link>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </Col>

            <Col xs={24} xl={9}>
              <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                <Card title="今日工作焦点">
                  <Space orientation="vertical" size={0} style={{ width: "100%" }}>
                    {[
                      {
                        label: "逾期与异常提醒",
                        value: data.supervision.openAlerts,
                        href: "/workspace/supervision",
                        color: "red",
                      },
                      {
                        label: "申请记录",
                        value: data.applicationTotal,
                        href: "/workspace/applications",
                        color: "blue",
                      },
                      {
                        label: "未读消息",
                        value: data.unreadNotificationTotal,
                        href: "/workspace/notifications",
                        color: "gold",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto auto",
                          gap: 12,
                          alignItems: "center",
                          width: "100%",
                          padding: "10px 0",
                          borderBottom: "1px solid rgb(5 5 5 / 6%)",
                        }}
                      >
                        {item.label}
                        <Tag color={item.color}>{item.value}</Tag>
                        <Link href={item.href}>处理</Link>
                      </div>
                    ))}
                  </Space>
                </Card>

                <Card title="常用入口">
                  <Space wrap>
                    <Link href="/workspace/supervision">
                      <Button>监督管理看板</Button>
                    </Link>
                    <Link href="/workspace/materials">
                      <Button>资料审核</Button>
                    </Link>
                    <Link href="/workspace/applications">
                      <Button>申请进度</Button>
                    </Link>
                    <Link href="/workspace/system/audit-logs">
                      <Button>审计日志</Button>
                    </Link>
                  </Space>
                </Card>
              </Space>
            </Col>
          </Row>
        </Space>
      ) : null}
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
            <Tag color="blue" style={{ marginTop: 16 }}>
              v1.0.0
            </Tag>
          </Card>
        </Col>
      </Row>
    </PageShell>
  );
}

export default function WorkspaceHomePage() {
  const { user } = useAuth();
  if (!user) return <Skeleton active paragraph={{ rows: 5 }} />;

  const hasAdminOverview =
    user.roles.includes(RoleCode.ADMINISTRATOR) &&
    user.permissions.includes(PermissionCode.TASK_SUPERVISION_READ);

  return hasAdminOverview ? <AdminWorkspace /> : <RoleWorkspace />;
}
