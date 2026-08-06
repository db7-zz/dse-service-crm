"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { getButlerSupervision, rejectStudentBlocker, reviewButlerWeekly } from "./task-api";
import type { ButlerAnomaly, ButlerAnomalyStatus, ButlerSupervisionDashboard } from "./task-types";
import styles from "./butler-supervision-page.module.css";

type ButlerItem = ButlerSupervisionDashboard["items"][number];
type ReviewDecision = "RECTIFIED" | "APPEAL_ACCEPTED" | "APPEAL_REJECTED";

const STATUS: Record<ButlerAnomalyStatus, { label: string; color: string }> = {
  OPEN: { label: "待整改", color: "error" },
  RECTIFIED: { label: "已整改", color: "success" },
  APPEAL_ACCEPTED: { label: "申诉通过", color: "blue" },
  APPEAL_REJECTED: { label: "申诉驳回", color: "warning" },
};

const REVIEW_STATUS = {
  LIVE: { label: "本周实时", color: "processing" },
  PENDING_RESPONSE: { label: "待管家说明", color: "warning" },
  PENDING_REVIEW: { label: "待管理员复核", color: "purple" },
  CLOSED: { label: "已复核", color: "success" },
} as const;

function date(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function weekLabel(start: string, end: string) {
  return `${date(start)} – ${date(end)}`;
}

function anomalyTypeLabel(type: ButlerAnomaly["type"]) {
  return {
    TASK_OVERDUE_UNREPORTED: "逾期未上报",
    STUDENT_BLOCKER_FOLLOWUP_MISSED: "学生阻塞未跟进",
    STUDENT_BLOCKER_REJECTED: "阻塞上报被驳回",
    WEEKLY_RESPONSE_OVERDUE: "周清单回复逾期",
  }[type];
}

export function ButlerSupervisionPage() {
  const { message } = App.useApp();
  const [data, setData] = useState<ButlerSupervisionDashboard>();
  const [selectedWeek, setSelectedWeek] = useState<string>();
  const [selected, setSelected] = useState<ButlerItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState<{ blockerId: string; description: string }>();
  const [rejectNote, setRejectNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [working, setWorking] = useState(false);

  const load = useCallback(async (weekStart?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await getButlerSupervision(weekStart);
      setData(next);
      setSelectedWeek(next.selectedWeek.weekStart);
      setSelected((current) => next.items.find((item) => item.id === current?.id));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "管家监督数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const maxTrend = Math.max(1, ...(data?.trend.map((item) => item.total) ?? [1]));
  const maxRanking = Math.max(1, ...(data?.items.map((item) => item.total) ?? [1]));
  const canNext = data ? new Date(data.selectedWeek.weekEnd) < new Date() : false;

  const selectedReview = selected?.review;
  const selectedItems = useMemo(() => selectedReview?.items ?? [], [selectedReview?.items]);

  const shiftWeek = (direction: number) => {
    if (!selectedWeek) return;
    const next = new Date(new Date(selectedWeek).getTime() + direction * 7 * 24 * 60 * 60 * 1000);
    void load(next.toISOString());
  };

  const openReview = () => {
    if (!selectedReview) return;
    setDecisions(
      Object.fromEntries(selectedReview.items.map((item) => [item.anomaly.id, "RECTIFIED"])),
    );
    setReviewNote("");
    setReviewOpen(true);
  };

  return (
    <PermissionPage permission={PermissionCode.TASK_SUPERVISION_READ}>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Butler accountability</p>
            <h1 className={styles.title}>管家监督</h1>
            <p className={styles.lead}>
              这里只记录需要追责的管家异常：任务到期未完成且未按时上报学生阻塞。正常推进不占用管理注意力。
            </p>
          </div>
          <div className={styles.weekControl}>
            <Button icon={<LeftOutlined />} aria-label="上一周" onClick={() => shiftWeek(-1)} />
            <Button onClick={() => void load()}>
              {data ? weekLabel(data.selectedWeek.weekStart, data.selectedWeek.weekEnd) : "本周"}
            </Button>
            <Button
              icon={<RightOutlined />}
              aria-label="下一周"
              disabled={!canNext}
              onClick={() => shiftWeek(1)}
            />
          </div>
        </section>

        {error ? (
          <Alert
            type="error"
            showIcon
            title="监督数据暂时无法加载"
            description={error}
            action={<Button onClick={() => void load(selectedWeek)}>重试</Button>}
          />
        ) : loading && !data ? (
          <Skeleton active paragraph={{ rows: 12 }} />
        ) : data ? (
          <>
            <section className={styles.metrics} aria-label="本周异常摘要">
              <div className={styles.metric}>
                <strong>{data.summary.total}</strong>
                <span>本周计入异常</span>
              </div>
              <div className={styles.metric}>
                <strong>{data.summary.newCount}</strong>
                <span>本周新增</span>
              </div>
              <div className={styles.metric}>
                <strong>{data.summary.carriedCount}</strong>
                <span>跨周未解决</span>
              </div>
              <div className={styles.metric}>
                <strong>{data.summary.pendingVerificationCount}</strong>
                <span>待核验学生阻塞</span>
              </div>
            </section>

            <section className={styles.visualGrid}>
              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2>近 12 周异常量</h2>
                  <span>点击柱形切换到对应周</span>
                </div>
                <div className={styles.trend}>
                  {data.trend.map((item) => {
                    const active = item.weekStart === data.selectedWeek.weekStart;
                    return (
                      <button
                        className={`${styles.trendButton} ${active ? styles.trendButtonActive : ""}`}
                        key={item.weekStart}
                        type="button"
                        title={`${weekLabel(item.weekStart, item.weekEnd)}：${item.total} 项`}
                        onClick={() => void load(item.weekStart)}
                      >
                        <span className={styles.trendTrack}>
                          <span
                            className={styles.trendBar}
                            style={{ height: `${Math.max(3, (item.total / maxTrend) * 100)}%` }}
                          >
                            <span className={styles.trendValue}>{item.total}</span>
                          </span>
                        </span>
                        <span className={styles.trendLabel}>{date(item.weekStart)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={styles.panel}>
                <div className={styles.panelHead}>
                  <h2>管家异常排行</h2>
                  <span>只按数量排序，不打分</span>
                </div>
                <div className={styles.rankList}>
                  {data.items.map((item) => (
                    <button
                      className={styles.rankButton}
                      type="button"
                      key={item.id}
                      onClick={() => setSelected(item)}
                    >
                      <span>{item.displayName}</span>
                      <span className={styles.rankTrack}>
                        <span
                          className={styles.rankFill}
                          style={{ width: `${(item.total / maxRanking) * 100}%` }}
                        />
                      </span>
                      <span className={styles.rankCount}>{item.total}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <h2>按管家查看</h2>
                <span>按本周异常总量从高到低</span>
              </div>
              <div className={styles.butlerList}>
                {data.items.map((item) => (
                  <button
                    className={styles.butlerRow}
                    type="button"
                    key={item.id}
                    onClick={() => setSelected(item)}
                  >
                    <span className={styles.butlerName}>
                      <strong>{item.displayName}</strong>
                      <span>
                        {item.review ? REVIEW_STATUS[item.review.status].label : "本周无清单"}
                      </span>
                    </span>
                    <span className={styles.fact}>
                      <strong>{item.total}</strong>
                      <span>合计</span>
                    </span>
                    <span className={styles.fact}>
                      <strong>{item.newCount}</strong>
                      <span>新增</span>
                    </span>
                    <span className={styles.fact}>
                      <strong>{item.carriedCount}</strong>
                      <span>跨周</span>
                    </span>
                    <span className={styles.studentNames}>
                      {item.affectedStudents.map((student) => student.name).join("、") ||
                        "本周无异常学生"}
                    </span>
                    <span
                      className={styles.rowAction}
                      data-active={item.openCount ? "true" : "false"}
                    >
                      查看异常
                    </span>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </main>

      <Drawer
        size={620}
        title={selected ? `${selected.displayName} · ${selected.total} 项异常` : "异常详情"}
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        extra={
          selectedReview?.status === "PENDING_REVIEW" ? (
            <Button type="primary" onClick={openReview}>
              复核周清单
            </Button>
          ) : null
        }
      >
        {selected ? (
          <>
            <div className={styles.drawerSummary}>
              <div>
                <strong>{selected.newCount}</strong>
                <span>本周新增</span>
              </div>
              <div>
                <strong>{selected.carriedCount}</strong>
                <span>跨周未解决</span>
              </div>
              <div>
                <strong>{selected.openCount}</strong>
                <span>仍待解决</span>
              </div>
            </div>
            {selectedReview ? (
              <Alert
                style={{ marginBottom: 16 }}
                type={selectedReview.status === "PENDING_REVIEW" ? "info" : "warning"}
                showIcon
                title={REVIEW_STATUS[selectedReview.status].label}
                description={
                  selectedReview.status === "LIVE"
                    ? "本周清单实时更新，下周一自动冻结并发送给管家。"
                    : selectedReview.status === "PENDING_RESPONSE"
                      ? `管家需在 ${dateTime(selectedReview.responseDueAt!)} 前逐项说明。`
                      : selectedReview.status === "PENDING_REVIEW"
                        ? "管家已逐项说明，等待管理员统一复核。"
                        : selectedReview.reviewNote || "该周清单已完成复核。"
                }
              />
            ) : null}
            {selected.pendingBlockers.length > 0 ? (
              <section style={{ marginBottom: 18 }}>
                <Typography.Title level={5}>学生阻塞待核验</Typography.Title>
                <Alert
                  style={{ marginBottom: 10 }}
                  type="info"
                  showIcon
                  title="按时上报默认有效，不计入异常"
                  description="管理员只在事实不成立时驳回；驳回后才形成永久管家异常。"
                />
                <div className={styles.anomalyList}>
                  {selected.pendingBlockers.map((blocker) => (
                    <article className={styles.anomalyCard} key={blocker.id}>
                      <Tag color="blue">待核验</Tag>
                      <h3 className={styles.anomalyTitle}>
                        {blocker.student.name} · {blocker.task.title}
                      </h3>
                      <p className={styles.anomalyText}>{blocker.description}</p>
                      <p className={styles.anomalyMeta}>
                        截止前上报 · 预计恢复 {dateTime(blocker.expectedRecoveryAt)}
                      </p>
                      <Space style={{ marginTop: 10 }}>
                        <Link href={`/workspace/tasks/${blocker.task.id}`}>查看任务留痕</Link>
                        <Button
                          danger
                          size="small"
                          onClick={() =>
                            setRejecting({
                              blockerId: blocker.id,
                              description: blocker.description,
                            })
                          }
                        >
                          驳回并记异常
                        </Button>
                      </Space>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            <div className={styles.anomalyList}>
              {selected.anomalies.length === 0 ? (
                <Empty description="本周没有管家异常" />
              ) : (
                selected.anomalies.map((anomaly) => {
                  const response = selectedItems.find(
                    (item) => item.anomaly.id === anomaly.id,
                  )?.responseNote;
                  const isNew =
                    data && new Date(anomaly.occurredAt) >= new Date(data.selectedWeek.weekStart);
                  return (
                    <article className={styles.anomalyCard} key={anomaly.id}>
                      <Space wrap>
                        <Tag color={STATUS[anomaly.status].color}>
                          {STATUS[anomaly.status].label}
                        </Tag>
                        <Tag>{isNew ? "本周新增" : "跨周未解决"}</Tag>
                        <Tag>{anomalyTypeLabel(anomaly.type)}</Tag>
                      </Space>
                      <h3 className={styles.anomalyTitle}>{anomaly.title}</h3>
                      <p className={styles.anomalyMeta}>
                        {anomaly.student
                          ? `${anomaly.student.name} · ${anomaly.student.studentNo} · `
                          : ""}
                        发生于 {dateTime(anomaly.occurredAt)}
                      </p>
                      {anomaly.task ? (
                        <p className={styles.anomalyText}>
                          任务：
                          <Link href={`/workspace/tasks/${anomaly.task.id}`}>
                            {anomaly.task.title}
                          </Link>
                        </p>
                      ) : null}
                      {anomaly.blocker ? (
                        <p className={styles.anomalyText}>
                          阻塞说明：{anomaly.blocker.description} · 预计恢复{" "}
                          {dateTime(anomaly.blocker.expectedRecoveryAt)}
                        </p>
                      ) : null}
                      {response ? (
                        <Alert
                          style={{ marginTop: 10 }}
                          type="info"
                          title="管家说明"
                          description={response}
                        />
                      ) : null}
                      {anomaly.resolutionNote ? (
                        <p className={styles.anomalyText}>复核留痕：{anomaly.resolutionNote}</p>
                      ) : null}
                      {anomaly.blocker?.status === "ACTIVE" ? (
                        <Button
                          danger
                          size="small"
                          style={{ marginTop: 10 }}
                          onClick={() =>
                            setRejecting({
                              blockerId: anomaly.blocker!.id,
                              description: anomaly.blocker!.description,
                            })
                          }
                        >
                          驳回学生阻塞上报
                        </Button>
                      ) : null}
                    </article>
                  );
                })
              )}
            </div>
          </>
        ) : null}
      </Drawer>

      <Modal
        title="驳回学生阻塞上报"
        open={Boolean(rejecting)}
        okText="确认驳回并记异常"
        okButtonProps={{ danger: true, disabled: !rejectNote.trim() }}
        confirmLoading={working}
        onCancel={() => {
          setRejecting(undefined);
          setRejectNote("");
        }}
        onOk={async () => {
          if (!rejecting || !rejectNote.trim()) return;
          setWorking(true);
          try {
            await rejectStudentBlocker(rejecting.blockerId, rejectNote);
            await message.success("阻塞上报已驳回，并形成永久异常记录");
            setRejecting(undefined);
            setRejectNote("");
            await load(selectedWeek);
          } catch (exception) {
            await message.error(exception instanceof Error ? exception.message : "驳回失败");
          } finally {
            setWorking(false);
          }
        }}
      >
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          title="驳回后将生成不可删除的管家异常"
          description={rejecting?.description}
        />
        <Input.TextArea
          rows={4}
          maxLength={1000}
          showCount
          placeholder="说明驳回依据"
          value={rejectNote}
          onChange={(event) => setRejectNote(event.target.value)}
        />
      </Modal>

      <Modal
        width={700}
        title="复核周异常清单"
        open={reviewOpen}
        okText="完成复核"
        okButtonProps={{ disabled: !reviewNote.trim() }}
        confirmLoading={working}
        onCancel={() => setReviewOpen(false)}
        onOk={async () => {
          if (!selectedReview || !reviewNote.trim()) return;
          setWorking(true);
          try {
            await reviewButlerWeekly({
              reviewId: selectedReview.id,
              version: selectedReview.version,
              note: reviewNote,
              items: selectedReview.items.map((item) => ({
                anomalyId: item.anomaly.id,
                decision: decisions[item.anomaly.id] ?? "RECTIFIED",
              })),
            });
            await message.success("周异常清单已复核，原始异常事实继续保留");
            setReviewOpen(false);
            await load(selectedWeek);
          } catch (exception) {
            await message.error(exception instanceof Error ? exception.message : "复核失败");
          } finally {
            setWorking(false);
          }
        }}
      >
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {selectedReview?.items.map((item) => (
            <div className={styles.anomalyCard} key={item.id}>
              <Typography.Text strong>{item.anomaly.title}</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: "6px 0 10px" }}>
                管家说明：{item.responseNote || "未填写"}
              </Typography.Paragraph>
              <Select
                style={{ width: "100%" }}
                value={decisions[item.anomaly.id] ?? "RECTIFIED"}
                onChange={(value) =>
                  setDecisions((current) => ({ ...current, [item.anomaly.id]: value }))
                }
                options={[
                  { value: "RECTIFIED", label: "已整改（异常事实保留）" },
                  { value: "APPEAL_ACCEPTED", label: "申诉通过（异常事实保留）" },
                  { value: "APPEAL_REJECTED", label: "申诉驳回（继续跨周统计）" },
                ]}
              />
            </div>
          ))}
          <Input.TextArea
            rows={4}
            maxLength={2000}
            showCount
            placeholder="填写统一复核意见"
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
          />
        </Space>
      </Modal>
    </PermissionPage>
  );
}
