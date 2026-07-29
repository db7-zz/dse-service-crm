"use client";

import { Card, Col, Row, Tag, Typography } from "antd";
import { RoleCode } from "@dse/shared";
import { useAuth } from "../../src/auth/auth-context";
import { PageShell } from "../../src/layout/page-shell";

export default function WorkspaceHomePage() {
  const { user } = useAuth();
  return (
    <PageShell
      title="工作区"
      description="阶段0只验证角色隔离、公共布局和基础状态，业务功能将在对应阶段开放。"
    >
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="当前账号">
            <Typography.Title level={4}>{user?.displayName}</Typography.Title>
            <Typography.Paragraph type="secondary">@{user?.username}</Typography.Paragraph>
            {user?.roles.map((role) => (
              <Tag key={role}>
                {
                  {
                    [RoleCode.ADMINISTRATOR]: "管理员",
                    [RoleCode.ERIC_MANAGER]: "业务负责人",
                    [RoleCode.BUTLER]: "管家",
                    [RoleCode.PLANNER]: "规划老师",
                    [RoleCode.SPECIALIST]: "专项老师",
                    [RoleCode.STUDENT]: "学生",
                  }[role]
                }
              </Tag>
            ))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="阶段状态">
            <Typography.Paragraph>
              技术底座正在运行。学生档案、任务监督、资料和申请管理均未在本阶段启用。
            </Typography.Paragraph>
            <Tag color="blue">S0 · v0.1.0</Tag>
          </Card>
        </Col>
      </Row>
    </PageShell>
  );
}
