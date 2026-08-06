"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import {
  listMyTasks,
  listMyWeeklyReviews,
  submitMyWeeklyReview,
} from "../../../src/tasks/task-api";
import type { ButlerWeeklyReview, TaskPage, TaskStatus } from "../../../src/tasks/task-types";
import {
  listRectifications,
  submitRectification,
} from "../../../src/rectifications/rectification-api";
import type { RectificationRecord } from "../../../src/rectifications/rectification-types";
import styles from "../../../src/tasks/task-page.module.css";

const STATUS = {
  TODO: { label: "待开始", color: "default" },
  IN_PROGRESS: { label: "进行中", color: "blue" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELED: { label: "已取消", color: "default" },
  NOT_APPLICABLE: { label: "不适用", color: "default" },
} as const;

function hk(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function MyTasksPage() {
  const [data, setData] = useState<TaskPage>();
  const [status, setStatus] = useState<TaskStatus>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [rectifications, setRectifications] = useState<RectificationRecord[]>([]);
  const [selectedRectification, setSelectedRectification] = useState<RectificationRecord>();
  const [responseNote, setResponseNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [weeklyReviews, setWeeklyReviews] = useState<ButlerWeeklyReview[]>([]);
  const [selectedWeekly, setSelectedWeekly] = useState<ButlerWeeklyReview>();
  const [weeklyResponses, setWeeklyResponses] = useState<Record<string, string>>({});
  const { message } = App.useApp();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [tasks, records, weekly] = await Promise.all([
        listMyTasks({ page, pageSize: 20, status }),
        listRectifications({ mine: true, pageSize: 100 }),
        listMyWeeklyReviews(),
      ]);
      setData(tasks);
      setRectifications(records.items.filter((record) => record.status !== "CLOSED"));
      setWeeklyReviews(weekly.items.filter((review) => review.status !== "CLOSED"));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "任务加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PermissionPage permission={PermissionCode.TASKS_OWN_READ}>
      <main className={styles.page}>
        <section className={`${styles.hero} ${styles.compactHero}`}>
          <div>
            <span className={styles.eyebrow}>My work queue</span>
            <h1 className={styles.title}>我的任务</h1>
            <p className={styles.lead}>
              只显示分配给当前管家的任务。未分配任务不会进入此处，也不能由管家执行。
            </p>
          </div>
          <Button onClick={() => void load()}>刷新任务</Button>
        </section>

        {weeklyReviews.some((review) => review.status !== "LIVE") ? (
          <Card title="周异常清单" style={{ marginBottom: 20 }}>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {weeklyReviews
                .filter((review) => review.status !== "LIVE")
                .map((review) => (
                  <div
                    key={review.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto",
                      gap: 16,
                      paddingBottom: 12,
                      borderBottom: "1px solid rgb(5 5 5 / 6%)",
                    }}
                  >
                    <Space orientation="vertical" size={4}>
                      <Space wrap>
                        <Tag
                          color={review.status === "PENDING_RESPONSE" ? "warning" : "processing"}
                        >
                          {review.status === "PENDING_RESPONSE" ? "待逐项说明" : "待管理员复核"}
                        </Tag>
                        <Typography.Text type="secondary">
                          {new Intl.DateTimeFormat("zh-HK", {
                            timeZone: "Asia/Hong_Kong",
                            month: "numeric",
                            day: "numeric",
                          }).format(new Date(review.weekStart))}
                          周 · {review.items.length} 项异常
                        </Typography.Text>
                      </Space>
                      <Typography.Text>
                        {review.status === "PENDING_RESPONSE"
                          ? `请在 ${review.responseDueAt ? hk(review.responseDueAt) : "规定时间"} 前逐项说明`
                          : "已提交，等待管理员统一复核"}
                      </Typography.Text>
                    </Space>
                    <Button
                      type="primary"
                      disabled={review.status !== "PENDING_RESPONSE"}
                      onClick={() => {
                        setSelectedWeekly(review);
                        setWeeklyResponses(
                          Object.fromEntries(
                            review.items.map((item) => [item.anomaly.id, item.responseNote ?? ""]),
                          ),
                        );
                      }}
                    >
                      {review.status === "PENDING_RESPONSE" ? "逐项填写说明" : "已提交"}
                    </Button>
                  </div>
                ))}
            </Space>
          </Card>
        ) : null}

        {rectifications.length > 0 ? (
          <Card title={`整改事项（${rectifications.length}）`} style={{ marginBottom: 20 }}>
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {rectifications.map((record) => (
                <div
                  key={record.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 16,
                    paddingBottom: 12,
                    borderBottom: "1px solid rgb(5 5 5 / 6%)",
                  }}
                >
                  <Space orientation="vertical" size={4}>
                    <Space wrap>
                      <Tag color={record.status === "PENDING_REVIEW" ? "processing" : "warning"}>
                        {record.status === "PENDING_REVIEW" ? "待管理员复核" : "待整改"}
                      </Tag>
                      <Typography.Text
                        type={new Date(record.dueAt) < new Date() ? "danger" : "secondary"}
                      >
                        截止 {hk(record.dueAt)}
                      </Typography.Text>
                    </Space>
                    <Typography.Text strong>{record.summary}</Typography.Text>
                    <Typography.Text type="secondary">
                      关联 {record.items.length} 项异常
                      {record.reviewNote ? ` · 管理员意见：${record.reviewNote}` : ""}
                    </Typography.Text>
                  </Space>
                  <Button
                    type="primary"
                    disabled={record.status !== "PENDING_RECTIFICATION"}
                    onClick={() => setSelectedRectification(record)}
                  >
                    {record.status === "PENDING_REVIEW" ? "已提交" : "提交整改结果"}
                  </Button>
                </div>
              ))}
            </Space>
          </Card>
        ) : null}

        <section className={styles.surface}>
          <div className={styles.filters}>
            <Select
              allowClear
              placeholder="全部活动任务"
              value={status}
              onChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
              options={Object.entries(STATUS).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
            />
          </div>
          {error ? (
            <Alert
              type="error"
              showIcon
              title="任务暂时无法加载"
              description={error}
              action={<Button onClick={() => void load()}>重试</Button>}
            />
          ) : loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : !data?.items.length ? (
            <Empty description="当前筛选下没有任务" />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>学生</th>
                      <th>阶段</th>
                      <th>状态</th>
                      <th>截止时间</th>
                      <th>最近更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <Link className={styles.taskLink} href={`/workspace/tasks/${task.id}`}>
                            {task.title}
                          </Link>
                          <span className={styles.subtle}>{task.sopVersion.displayVersion}</span>
                        </td>
                        <td>
                          {task.student.name}
                          <span className={styles.subtle}>{task.student.studentNo}</span>
                        </td>
                        <td>
                          {task.stage.sequenceNo}. {task.stage.name}
                        </td>
                        <td>
                          <Tag color={STATUS[task.status].color}>{STATUS[task.status].label}</Tag>
                          {task.isOverdue ? <Tag color="red">逾期</Tag> : null}
                        </td>
                        <td className={task.isOverdue ? styles.overdue : ""}>
                          {hk(task.currentDueAt)}
                        </td>
                        <td>{hk(task.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <Pagination
                  current={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  showSizeChanger={false}
                  onChange={setPage}
                />
              </div>
            </>
          )}
        </section>

        <Modal
          title="提交整改结果"
          open={Boolean(selectedRectification)}
          onCancel={() => {
            setSelectedRectification(undefined);
            setResponseNote("");
          }}
          okText="提交管理员复核"
          okButtonProps={{ disabled: !responseNote.trim() }}
          confirmLoading={submitting}
          onOk={async () => {
            if (!selectedRectification || !responseNote.trim()) return;
            setSubmitting(true);
            try {
              await submitRectification({
                id: selectedRectification.id,
                version: selectedRectification.version,
                note: responseNote.trim(),
              });
              await message.success("整改结果已提交管理员复核");
              setSelectedRectification(undefined);
              setResponseNote("");
              await load();
            } catch (exception) {
              await message.error(exception instanceof Error ? exception.message : "提交失败");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              title={selectedRectification?.summary}
              description={`关联 ${selectedRectification?.items.length ?? 0} 项异常；管理员复核通过后才会关闭。`}
            />
            <Input.TextArea
              rows={5}
              value={responseNote}
              onChange={(event) => setResponseNote(event.target.value)}
              placeholder="说明每项异常的处理结果、原因和后续措施"
              maxLength={4000}
              showCount
            />
          </Space>
        </Modal>

        <Modal
          width={720}
          title="逐项填写周异常说明"
          open={Boolean(selectedWeekly)}
          okText="提交管理员复核"
          confirmLoading={submitting}
          okButtonProps={{
            disabled:
              !selectedWeekly ||
              selectedWeekly.items.some((item) => !weeklyResponses[item.anomaly.id]?.trim()),
          }}
          onCancel={() => {
            setSelectedWeekly(undefined);
            setWeeklyResponses({});
          }}
          onOk={async () => {
            if (!selectedWeekly) return;
            setSubmitting(true);
            try {
              await submitMyWeeklyReview({
                reviewId: selectedWeekly.id,
                version: selectedWeekly.version,
                items: selectedWeekly.items.map((item) => ({
                  anomalyId: item.anomaly.id,
                  responseNote: weeklyResponses[item.anomaly.id]!.trim(),
                })),
              });
              await message.success("周异常说明已提交管理员复核");
              setSelectedWeekly(undefined);
              setWeeklyResponses({});
              await load();
            } catch (exception) {
              await message.error(exception instanceof Error ? exception.message : "提交失败");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              title="异常事实不会因补充说明而删除"
              description="请逐项说明原因、已完成的整改动作和下一步。管理员会统一复核每一项。"
            />
            {selectedWeekly?.items.map((item) => (
              <Card size="small" key={item.id} title={item.anomaly.title}>
                <Typography.Paragraph type="secondary">
                  {item.anomaly.student ? `${item.anomaly.student.name} · ` : ""}
                  发生于 {hk(item.anomaly.occurredAt)}
                </Typography.Paragraph>
                <Input.TextArea
                  rows={3}
                  maxLength={2000}
                  showCount
                  placeholder="填写原因、整改动作和后续安排"
                  value={weeklyResponses[item.anomaly.id] ?? ""}
                  onChange={(event) =>
                    setWeeklyResponses((current) => ({
                      ...current,
                      [item.anomaly.id]: event.target.value,
                    }))
                  }
                />
              </Card>
            ))}
          </Space>
        </Modal>
      </main>
    </PermissionPage>
  );
}
