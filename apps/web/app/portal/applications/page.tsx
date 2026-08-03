"use client";

import { useEffect, useState } from "react";
import { Card, Col, Empty, List, Row, Space, Tag } from "antd";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import { getPortalApplications } from "../../../src/portal/portal-api";

type ApplicationData = Awaited<ReturnType<typeof getPortalApplications>>["items"];

export default function PortalApplicationsPage() {
  const [items, setItems] = useState<ApplicationData>([]);
  useEffect(() => {
    void getPortalApplications().then((result) => setItems(result.items));
  }, []);
  return (
    <>
      <PortalPageTitle
        title="申请动态"
        description="查看院校申请状态、结果与需要留意的补件或确认节点。"
      />
      {items.length ? (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col xs={24} md={12} key={item.id}>
              <Card
                title={item.institutionName}
                extra={
                  <Tag
                    color={
                      item.status === "OFFER" || item.status === "ENROLLED"
                        ? "success"
                        : "processing"
                    }
                  >
                    {item.status}
                  </Tag>
                }
              >
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                  <strong>{item.programName ?? "未填写专业"}</strong>
                  <span>渠道：{item.channel === "JUPAS" ? "JUPAS" : "港校直申"}</span>
                  <span>申请编号：{item.applicationNo ?? "—"}</span>
                  <span>结果：{item.result ?? "等待更新"}</span>
                  {item.offerCondition ? <span>录取条件：{item.offerCondition}</span> : null}
                  {item.reminders.length ? (
                    <List
                      size="small"
                      header="待留意节点"
                      dataSource={item.reminders}
                      renderItem={(entry) => (
                        <List.Item>
                          <Space direction="vertical" size={0}>
                            <span>{entry.description}</span>
                            <small>
                              {entry.dueAt
                                ? `截止 ${new Date(entry.dueAt).toLocaleString("zh-CN")}`
                                : ""}
                            </small>
                          </Space>
                        </List.Item>
                      )}
                    />
                  ) : null}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description="暂无申请记录" />
      )}
    </>
  );
}
