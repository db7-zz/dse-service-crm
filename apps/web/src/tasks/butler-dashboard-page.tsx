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
  Select,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  type TableColumnsType,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { PageShell } from "../layout/page-shell";
import {
  createRectification,
  listRectifications,
  reviewRectification,
} from "../rectifications/rectification-api";
import type {
  RectificationRecord,
  RectificationStatus,
} from "../rectifications/rectification-types";
import { getButlerDashboard } from "./task-api";
import type { ButlerDashboard, ButlerDashboardItem, ButlerRiskLevel } from "./task-types";

const RISK: Record<ButlerRiskLevel, { label: string; color: string }> = {
  URGENT: { label: "紧急", color: "error" },
  WARNING: { label: "警告", color: "warning" },
  REMINDER: { label: "提醒", color: "processing" },
  NORMAL: { label: "正常", color: "success" },
};

const RECTIFICATION_STATUS: Record<RectificationStatus, { label: string; color: string }> = {
  PENDING_RECTIFICATION: { label: "待整改", color: "warning" },
  PENDING_REVIEW: { label: "待管理员复核", color: "processing" },
  CLOSED: { label: "已关闭", color: "success" },
};

function hk(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function overdueAge(value: string | null) {
  if (!value) return "—";
  const hours = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 3_600_000));
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`;
}

export function ButlerDashboardPage() {
  const { message } = App.useApp();
  const [dashboard, setDashboard] = useState<ButlerDashboard>();
  const [rectifications, setRectifications] = useState<RectificationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [activeTab, setActiveTab] = useState("overview");
  const [riskFilter, setRiskFilter] = useState<ButlerRiskLevel>();
  const [rectificationFilter, setRectificationFilter] = useState<RectificationStatus>();
  const [selectedButler, setSelectedButler] = useState<ButlerDashboardItem>();
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState<RectificationRecord>();
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [createForm] = Form.useForm<{
    selectedIds: string[];
    summary: string;
    dueAt: { toISOString(): string };
  }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [nextDashboard, nextRectifications] = await Promise.all([
        getButlerDashboard(),
        listRectifications({ pageSize: 100 }),
      ]);
      setDashboard(nextDashboard);
      setRectifications(nextRectifications.items);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "管家管理数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("tab") === "rectifications") setActiveTab("rectifications");
    const status = search.get("status") as RectificationStatus | null;
    if (status && status in RECTIFICATION_STATUS) setRectificationFilter(status);
    void load();
  }, [load]);

  const visibleButlers = useMemo(
    () => (dashboard?.items ?? []).filter((item) => !riskFilter || item.riskLevel === riskFilter),
    [dashboard?.items, riskFilter],
  );
  const visibleRectifications = useMemo(
    () =>
      rectifications.filter(
        (record) => !rectificationFilter || record.status === rectificationFilter,
      ),
    [rectificationFilter, rectifications],
  );

  const butlerColumns: TableColumnsType<ButlerDashboardItem> = [
    {
      title: "管家",
      dataIndex: "displayName",
      width: 130,
      render: (value: string, item) => (
        <Space orientation="vertical" size={2}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary">{item.studentCount} 名学生</Typography.Text>
        </Space>
      ),
    },
    {
      title: "风险",
      dataIndex: "riskLevel",
      width: 90,
      render: (value: ButlerRiskLevel) => <Tag color={RISK[value].color}>{RISK[value].label}</Tag>,
    },
    {
      title: "异常事实",
      width: 260,
      render: (_, item) => (
        <Space wrap size={[4, 4]}>
          {item.overdue > 0 ? <Tag color="error">{item.overdue} 项任务逾期</Tag> : null}
          {item.overdueIssueCount > 0 ? (
            <Tag color="volcano">{item.overdueIssueCount} 个问题超时</Tag>
          ) : null}
          {item.overdueRectificationCount > 0 ? (
            <Tag color="magenta">{item.overdueRectificationCount} 张整改单逾期</Tag>
          ) : null}
          {item.riskLevel === "REMINDER" ? (
            <Tag color="processing">任务将在 24 小时内到期</Tag>
          ) : null}
          {item.riskLevel === "NORMAL" ? (
            <Typography.Text type="secondary">暂无异常</Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: "最长逾期",
      dataIndex: "oldestOverdueAt",
      width: 110,
      render: (value: string | null) =>
        value ? <Typography.Text type="danger">{overdueAge(value)}</Typography.Text> : "—",
    },
    {
      title: "受影响学生",
      dataIndex: "affectedStudents",
      width: 220,
      render: (students: ButlerDashboardItem["affectedStudents"]) =>
        students.length > 0 ? (
          <Space wrap size={[4, 4]}>
            {students.slice(0, 3).map((student) => (
              <Link key={student.id} href={`/workspace/students/${student.id}`}>
                {student.name}
              </Link>
            ))}
            {students.length > 3 ? (
              <Typography.Text type="secondary">等 {students.length} 人</Typography.Text>
            ) : null}
          </Space>
        ) : (
          "—"
        ),
    },
    {
      title: "整改状态",
      dataIndex: "activeRectificationCount",
      width: 110,
      render: (value: number) =>
        value > 0 ? <Tag color="processing">{value} 张进行中</Tag> : "无",
    },
    {
      title: "操作",
      width: 110,
      fixed: "right",
      render: (_, item) => (
        <Button
          type="link"
          onClick={() => setSelectedButler(item)}
          disabled={item.anomalies.length === 0}
        >
          查看异常
        </Button>
      ),
    },
  ];

  const rectificationColumns: TableColumnsType<RectificationRecord> = [
    {
      title: "管家",
      dataIndex: ["butler", "displayName"],
      width: 120,
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 130,
      render: (status: RectificationStatus) => (
        <Tag color={RECTIFICATION_STATUS[status].color}>{RECTIFICATION_STATUS[status].label}</Tag>
      ),
    },
    {
      title: "整改要求",
      dataIndex: "summary",
      ellipsis: true,
    },
    {
      title: "关联异常",
      dataIndex: "items",
      width: 100,
      render: (items: RectificationRecord["items"]) => `${items.length} 项`,
    },
    {
      title: "截止时间",
      dataIndex: "dueAt",
      width: 180,
      render: (value: string, record) => (
        <Typography.Text
          type={record.status !== "CLOSED" && new Date(value) < new Date() ? "danger" : undefined}
        >
          {hk(value)}
        </Typography.Text>
      ),
    },
    {
      title: "管家说明",
      dataIndex: "responseNote",
      ellipsis: true,
      render: (value: string | null) => value ?? "尚未提交",
    },
    {
      title: "操作",
      width: 100,
      fixed: "right",
      render: (_, record) =>
        record.status === "PENDING_REVIEW" ? (
          <Button type="link" onClick={() => setReviewing(record)}>
            复核
          </Button>
        ) : (
          <Button type="link" onClick={() => setReviewing(record)}>
            查看
          </Button>
        ),
    },
  ];

  return (
    <PermissionPage permission={PermissionCode.TASK_SUPERVISION_READ}>
      <PageShell
        title="管家管理看板"
        description="按管家汇总可核验的逾期与整改事实，正常工作与异常介入分开管理。"
        extra={<Button onClick={() => void load()}>刷新状态</Button>}
      >
        {error ? (
          <Alert
            type="error"
            showIcon
            title="数据暂时无法加载"
            description={error}
            style={{ marginBottom: 16 }}
          />
        ) : null}
        {loading && !dashboard ? (
          <Skeleton active paragraph={{ rows: 12 }} />
        ) : dashboard ? (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={[
              {
                key: "overview",
                label: "履职概览",
                children: (
                  <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                    <Row gutter={[16, 16]}>
                      {[
                        ["管家总数", dashboard.summary.butlerCount, "blue"],
                        ["异常管家", dashboard.summary.abnormalButlerCount, "red"],
                        ["异常事项", dashboard.summary.attentionCount, "orange"],
                        ["待复核整改", dashboard.summary.pendingReviewCount, "cyan"],
                      ].map(([title, value, color]) => (
                        <Col xs={12} xl={6} key={String(title)}>
                          <Card styles={{ body: { padding: 18 } }}>
                            <Statistic
                              title={String(title)}
                              value={Number(value)}
                              styles={{ content: { color: `var(--ant-${String(color)})` } }}
                            />
                          </Card>
                        </Col>
                      ))}
                    </Row>
                    <Card
                      title="管家工作状态"
                      extra={
                        <Select
                          allowClear
                          placeholder="全部风险等级"
                          style={{ width: 150 }}
                          value={riskFilter}
                          onChange={setRiskFilter}
                          options={Object.entries(RISK).map(([value, meta]) => ({
                            value,
                            label: meta.label,
                          }))}
                        />
                      }
                    >
                      <Table
                        rowKey="id"
                        columns={butlerColumns}
                        dataSource={visibleButlers}
                        pagination={false}
                        scroll={{ x: 1050 }}
                      />
                    </Card>
                  </Space>
                ),
              },
              {
                key: "rectifications",
                label: `整改记录${dashboard.summary.pendingReviewCount ? ` (${dashboard.summary.pendingReviewCount})` : ""}`,
                children: (
                  <Card
                    title="整改闭环"
                    extra={
                      <Select
                        allowClear
                        placeholder="全部状态"
                        style={{ width: 170 }}
                        value={rectificationFilter}
                        onChange={setRectificationFilter}
                        options={Object.entries(RECTIFICATION_STATUS).map(([value, meta]) => ({
                          value,
                          label: meta.label,
                        }))}
                      />
                    }
                  >
                    <Table
                      rowKey="id"
                      columns={rectificationColumns}
                      dataSource={visibleRectifications}
                      pagination={{ pageSize: 10, hideOnSinglePage: true }}
                      scroll={{ x: 1050 }}
                      locale={{ emptyText: <Empty description="暂无整改记录" /> }}
                    />
                  </Card>
                ),
              },
            ]}
          />
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
          {selectedButler?.anomalies.length ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                showIcon
                type={selectedButler.riskLevel === "URGENT" ? "error" : "warning"}
                title={`${RISK[selectedButler.riskLevel].label} · ${selectedButler.anomalies.length} 项可核验异常`}
                description="这里只展示已超过明确截止时间的任务和问题。"
              />
              {selectedButler.anomalies.map((item) => (
                <Card key={`${item.type}:${item.id}`} size="small">
                  <Space orientation="vertical" size={4}>
                    <Space wrap>
                      <Tag color={item.type === "TASK" ? "red" : "volcano"}>
                        {item.type === "TASK" ? "逾期任务" : "超时问题"}
                      </Tag>
                      {item.isBlocking ? <Tag color="magenta">阻塞任务</Tag> : null}
                    </Space>
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text type="secondary">
                      {item.student.name} · 截止 {hk(item.dueAt)} · 已逾期 {overdueAge(item.dueAt)}
                    </Typography.Text>
                    {item.type === "TASK" ? (
                      <Link href={`/workspace/tasks/${item.id}`}>查看任务</Link>
                    ) : (
                      <Link href={`/workspace/issues?issueId=${item.id}`}>查看问题</Link>
                    )}
                  </Space>
                </Card>
              ))}
            </Space>
          ) : (
            <Empty description="暂无异常" />
          )}
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
                    .filter((id) => id.startsWith("TASK:"))
                    .map((id) => id.slice(5)),
                  issueIds: values.selectedIds
                    .filter((id) => id.startsWith("ISSUE:"))
                    .map((id) => id.slice(6)),
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

        <Modal
          title={reviewing?.status === "PENDING_REVIEW" ? "复核整改结果" : "整改记录详情"}
          open={Boolean(reviewing)}
          onCancel={() => {
            setReviewing(undefined);
            setReviewNote("");
          }}
          footer={
            reviewing?.status === "PENDING_REVIEW"
              ? [
                  <Button
                    key="return"
                    danger
                    loading={reviewBusy}
                    disabled={!reviewNote.trim()}
                    onClick={() => void performReview(false)}
                  >
                    退回整改
                  </Button>,
                  <Button
                    key="approve"
                    type="primary"
                    loading={reviewBusy}
                    disabled={!reviewNote.trim()}
                    onClick={() => void performReview(true)}
                  >
                    复核通过并关闭
                  </Button>,
                ]
              : [
                  <Button key="close" onClick={() => setReviewing(undefined)}>
                    关闭
                  </Button>,
                ]
          }
        >
          {reviewing ? (
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                type="info"
                showIcon
                title={reviewing.summary}
                description={`管家：${reviewing.butler.displayName} · 截止 ${hk(reviewing.dueAt)}`}
              />
              <Typography.Text strong>关联异常</Typography.Text>
              {reviewing.items.map((item) => (
                <Typography.Text key={item.id}>• {item.title}</Typography.Text>
              ))}
              <Typography.Text strong>管家整改说明</Typography.Text>
              <Typography.Paragraph>{reviewing.responseNote ?? "尚未提交"}</Typography.Paragraph>
              {reviewing.status === "PENDING_REVIEW" ? (
                <Input.TextArea
                  rows={4}
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="填写复核意见（必填）"
                  maxLength={4000}
                  showCount
                />
              ) : reviewing.reviewNote ? (
                <Alert
                  type="success"
                  showIcon
                  title="复核意见"
                  description={reviewing.reviewNote}
                />
              ) : null}
            </Space>
          ) : null}
        </Modal>
      </PageShell>
    </PermissionPage>
  );

  async function performReview(approve: boolean) {
    if (!reviewing || !reviewNote.trim()) return;
    setReviewBusy(true);
    try {
      await reviewRectification({
        id: reviewing.id,
        version: reviewing.version,
        approve,
        note: reviewNote.trim(),
      });
      await message.success(approve ? "整改单已复核关闭" : "整改单已退回管家");
      setReviewing(undefined);
      setReviewNote("");
      await load();
    } catch (exception) {
      await message.error(exception instanceof Error ? exception.message : "复核失败");
    } finally {
      setReviewBusy(false);
    }
  }
}
