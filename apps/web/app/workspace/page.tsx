"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Alert, Card, Col, Row, Tag, Typography } from "antd";
import { RoleCode } from "@dse/shared";
import { LoadingState } from "@dse/ui";
import { useAuth } from "../../src/auth/auth-context";
import { PageShell } from "../../src/layout/page-shell";
import { defaultRouteFor } from "../../src/navigation/navigation";

const ROLE_LABELS: Record<string, string> = {
  [RoleCode.ADMINISTRATOR]: "管理员",
  [RoleCode.ERIC_MANAGER]: "历史角色（已停用）",
  [RoleCode.BUTLER]: "管家",
  [RoleCode.PLANNER]: "规划老师",
  [RoleCode.SPECIALIST]: "专项老师",
  [RoleCode.STUDENT]: "学生",
};

export default function WorkspaceHomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const target = user ? defaultRouteFor(user) : "/workspace";

  useEffect(() => {
    if (user && target !== "/workspace") {
      router.replace(target);
    }
  }, [router, target, user]);

  if (!user || target !== "/workspace") {
    return <LoadingState rows={5} />;
  }

  const roleDescription = user.roles.includes(RoleCode.PLANNER)
    ? "S1 中，规划老师仅作为学生负责人关系被管理员分配和展示，当前不提供任务页面或任务操作权限。"
    : user.roles.includes(RoleCode.SPECIALIST)
      ? "专项老师工作台尚未进入当前版本范围。管理员可继续在系统中维护你的账号和角色。"
      : "当前角色暂未配置独立业务入口，请联系管理员确认账号权限。";

  return (
    <PageShell
      title="内部工作台"
      description="这里会根据角色展示当前可用范围，不会呈现尚未开放的业务入口。"
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="当前账号">
            <Typography.Title level={4}>{user?.displayName}</Typography.Title>
            <Typography.Paragraph type="secondary">@{user?.username}</Typography.Paragraph>
            {user?.roles.map((role) => (
              <Tag key={role}>{ROLE_LABELS[role] ?? role}</Tag>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="当前版本与权限">
            <Alert type="info" showIcon title="S1 · 任务监督闭环" description={roleDescription} />
            <Tag color="blue" style={{ marginTop: 16 }}>
              v0.2.0
            </Tag>
          </Card>
        </Col>
      </Row>
    </PageShell>
  );
}
