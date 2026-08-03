"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Col, Empty, List, Progress, Row, Skeleton, Space, Tag } from "antd";
import { PortalPageTitle } from "../../src/portal/portal-shell";
import {
  getPortalConfirmations,
  getPortalSummary,
  respondPortalConfirmation,
  type PortalSummary,
} from "../../src/portal/portal-api";

export default function PortalHomePage() {
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [confirmations, setConfirmations] = useState<
    Array<{ id: string; prompt: string; status: string; dueAt: string | null }>
  >([]);
  const load = () =>
    Promise.all([getPortalSummary(), getPortalConfirmations()]).then(
      ([nextSummary, nextConfirmations]) => {
        setSummary(nextSummary);
        setConfirmations(nextConfirmations.items);
      },
    );
  useEffect(() => {
    void load();
  }, []);
  if (!summary) return <Skeleton active paragraph={{ rows: 8 }} />;
  return (
    <>
      <PortalPageTitle
        title={`你好，${summary.student.name}`}
        description={`${summary.student.studentNo}${summary.student.school ? ` · ${summary.student.school}` : ""}，这里是你的升学服务最新进度。`}
      />
      {summary.serviceStatus === "PAUSED" ? (
        <Alert
          type="warning"
          showIcon
          message="服务当前处于暂停状态"
          style={{ marginBottom: 20 }}
        />
      ) : null}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card title="服务进度" extra={<Link href="/portal/progress">查看全部</Link>}>
            <Space direction="vertical" size={14} style={{ width: "100%" }}>
              <Progress
                percent={Math.round(((summary.progress?.completedStageCount ?? 0) / 8) * 100)}
                strokeColor="#1769aa"
              />
              <strong>
                {summary.progress?.currentStage
                  ? `当前：第 ${summary.progress.currentStage.sequenceNo} 阶段 · ${summary.progress.currentStage.name}`
                  : "服务阶段已完成或尚未启动"}
              </strong>
              <span style={{ color: "#69788b" }}>
                下一里程碑：{summary.progress?.nextMilestone ?? "等待老师更新"}
              </span>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card
            title="需要你处理"
            extra={
              <Tag
                color={
                  summary.todo.missingMaterials.length +
                  confirmations.filter((item) => item.status === "PENDING").length
                    ? "warning"
                    : "success"
                }
              >
                {summary.todo.missingMaterials.length +
                  confirmations.filter((item) => item.status === "PENDING").length}{" "}
                项
              </Tag>
            }
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              {summary.todo.missingMaterials.slice(0, 3).map((item) => (
                <Link key={item.id} href="/portal/materials">
                  补充资料：{item.title}
                </Link>
              ))}
              {confirmations
                .filter((item) => item.status === "PENDING")
                .slice(0, 2)
                .map((item) => (
                  <div key={item.id}>
                    <div>{item.prompt}</div>
                    <Space style={{ marginTop: 6 }}>
                      <Button
                        size="small"
                        type="primary"
                        onClick={() =>
                          void respondPortalConfirmation(item.id, "CONFIRMED").then(() => load())
                        }
                      >
                        确认
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          void respondPortalConfirmation(item.id, "DECLINED").then(() => load())
                        }
                      >
                        暂不确认
                      </Button>
                    </Space>
                  </div>
                ))}
              {summary.todo.missingMaterials.length === 0 &&
              confirmations.every((item) => item.status !== "PENDING") ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有待处理事项" />
              ) : null}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="近期任务">
            <List
              size="small"
              dataSource={summary.todo.tasks}
              locale={{ emptyText: "暂无对外任务" }}
              renderItem={(item) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <strong>{item.title}</strong>
                    <span style={{ color: "#69788b" }}>
                      截止 {new Date(item.dueAt).toLocaleString("zh-CN")}
                    </span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="申请动态" extra={<Link href="/portal/applications">查看全部</Link>}>
            <List
              size="small"
              dataSource={summary.applications}
              locale={{ emptyText: "暂无申请记录" }}
              renderItem={(item) => (
                <List.Item extra={<Tag>{item.status}</Tag>}>
                  <Space direction="vertical" size={0}>
                    <strong>{item.institutionName}</strong>
                    <span>{item.programName ?? "未填写专业"}</span>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </>
  );
}
