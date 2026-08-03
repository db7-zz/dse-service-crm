"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeftOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  EditOutlined,
  PlayCircleOutlined,
  StopOutlined,
  SwapOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Skeleton, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionDenied } from "@dse/ui";
import { useAuth } from "../../../../src/auth/auth-context";
import { getResponsiblePersonOptions } from "../../../../src/students/student-api";
import type { ResponsiblePersonOption } from "../../../../src/students/student-types";
import {
  cancelTask,
  completeTask,
  getTask,
  handleOverdueAlert,
  reassignTask,
  reportTaskExtension,
  rescheduleTask,
  startTask,
  updateTaskProgress,
} from "../../../../src/tasks/task-api";
import type { TaskDetail } from "../../../../src/tasks/task-types";
import styles from "../../../../src/tasks/task-page.module.css";

type Action = "progress" | "extension" | "complete" | "reschedule" | "reassign" | "cancel";

interface ActionValues {
  note?: string;
  reason?: string;
  percent?: number;
  dateTime?: string;
  ownerId?: string;
}

const STATUS = {
  TODO: { label: "待开始", color: "default" },
  IN_PROGRESS: { label: "进行中", color: "blue" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELED: { label: "已取消", color: "default" },
} as const;

const ACTION_TITLES: Record<Action, string> = {
  progress: "更新任务进展",
  extension: "提交延期报备",
  complete: "完成任务",
  reschedule: "调整截止时间",
  reassign: "转派任务",
  cancel: "取消任务",
};

const ROLE_LABELS: Record<string, string> = {
  ADMINISTRATOR: "管理员",
  BUTLER: "管家",
  PLANNER: "规划老师",
  SPECIALIST: "专项老师",
  STUDENT: "学生",
  SYSTEM: "系统",
};

function hk(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function hongKongDateTimeInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(value))
    .reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export default function TaskDetailPage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const params = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskDetail>();
  const [butlers, setButlers] = useState<ResponsiblePersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [action, setAction] = useState<Action>();
  const [form] = Form.useForm<ActionValues>();

  const canSupervise = user?.permissions.includes(PermissionCode.TASK_SUPERVISION_WRITE) ?? false;
  const canExecute = user?.permissions.includes(PermissionCode.TASKS_OWN_WRITE) ?? false;
  const canRead =
    user?.permissions.includes(PermissionCode.TASK_SUPERVISION_READ) ||
    user?.permissions.includes(PermissionCode.TASKS_OWN_READ);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [detail, options] = await Promise.all([
        getTask(params.taskId),
        canSupervise
          ? getResponsiblePersonOptions()
          : Promise.resolve({ butlers: [], planners: [] }),
      ]);
      setTask(detail);
      setButlers(options.butlers);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "任务详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [canSupervise, params.taskId]);

  useEffect(() => {
    if (canRead) void load();
  }, [canRead, load]);

  if (!canRead) {
    return (
      <PermissionDenied
        description="当前角色没有任务查看权限"
        action={<Button href="/workspace">返回工作区</Button>}
      />
    );
  }

  const runStart = () => {
    if (!task) return;
    modal.confirm({
      title: "开始执行这项任务？",
      content: "任务状态将从“待开始”更新为“进行中”，并写入时间线。",
      okText: "开始任务",
      cancelText: "取消",
      onOk: async () => {
        setWorking(true);
        try {
          setTask(await startTask(task.id, task.version));
          await message.success("任务已开始");
        } catch (exception) {
          await message.error(exception instanceof Error ? exception.message : "操作失败");
          await load();
        } finally {
          setWorking(false);
        }
      },
    });
  };

  const submitAction = async (values: ActionValues) => {
    if (!task || !action) return;
    setWorking(true);
    try {
      let updated: TaskDetail;
      if (action === "progress") {
        updated = await updateTaskProgress({
          taskId: task.id,
          version: task.version,
          progressNote: values.note!,
          progressPercent: values.percent,
        });
      } else if (action === "extension") {
        updated = await reportTaskExtension({
          taskId: task.id,
          version: task.version,
          reason: values.reason!,
          expectedFinishAt: new Date(values.dateTime!).toISOString(),
        });
      } else if (action === "complete") {
        updated = await completeTask({
          taskId: task.id,
          version: task.version,
          completionNote: values.note!,
        });
      } else if (action === "reschedule") {
        updated = await rescheduleTask({
          taskId: task.id,
          version: task.version,
          newDueAt: new Date(values.dateTime!).toISOString(),
          reason: values.reason!,
        });
      } else if (action === "reassign") {
        updated = await reassignTask({
          taskId: task.id,
          version: task.version,
          newOwnerId: values.ownerId!,
          reason: values.reason!,
        });
      } else {
        updated = await cancelTask({
          taskId: task.id,
          version: task.version,
          reason: values.reason!,
        });
      }
      setTask(updated);
      setAction(undefined);
      form.resetFields();
      await message.success(`${ACTION_TITLES[action]}成功`);
    } catch (exception) {
      await message.error(exception instanceof Error ? exception.message : "操作失败");
      await load();
    } finally {
      setWorking(false);
    }
  };

  const openAction = (next: Action) => {
    form.resetFields();
    if (next === "reschedule" && task) {
      form.setFieldsValue({ dateTime: hongKongDateTimeInput(task.currentDueAt) });
    }
    setAction(next);
  };

  return (
    <main className={styles.page}>
      <Link
        className={styles.back}
        href={canSupervise ? "/workspace/supervision" : "/workspace/my-tasks"}
      >
        <ArrowLeftOutlined />
        返回{canSupervise ? "监督看板" : "我的任务"}
      </Link>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="任务详情暂时无法加载"
          description={error}
          action={<Button onClick={() => void load()}>重试</Button>}
        />
      ) : loading || !task ? (
        <section className={styles.hero}>
          <Skeleton active paragraph={{ rows: 7 }} />
        </section>
      ) : (
        <>
          <section className={styles.hero}>
            <div className={styles.detailHeader} style={{ width: "100%" }}>
              <div>
                <span className={styles.eyebrow}>
                  {task.student.name} · 第 {task.stage.sequenceNo} 阶段
                </span>
                <h1 className={styles.title}>{task.title}</h1>
                <p className={styles.lead}>
                  {task.description || "请按完成标准执行"} · {task.sopVersion.displayVersion}
                </p>
              </div>
              <div>
                <Tag color={STATUS[task.status].color}>{STATUS[task.status].label}</Tag>
                {task.isOverdue ? <Tag color="red">已逾期</Tag> : null}
                {!task.owner ? <Tag>未分配</Tag> : null}
              </div>
            </div>

            <div className={styles.detailActions}>
              {canExecute && task.status === "TODO" && task.owner?.id === user?.id ? (
                <Button
                  type="primary"
                  icon={<PlayCircleOutlined />}
                  loading={working}
                  onClick={runStart}
                >
                  开始任务
                </Button>
              ) : null}
              {canExecute && task.status === "IN_PROGRESS" && task.owner?.id === user?.id ? (
                <>
                  <Button icon={<EditOutlined />} onClick={() => openAction("progress")}>
                    更新进展
                  </Button>
                  <Button icon={<ClockCircleOutlined />} onClick={() => openAction("extension")}>
                    延期报备
                  </Button>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => openAction("complete")}
                  >
                    完成任务
                  </Button>
                </>
              ) : null}
              {canSupervise && (task.status === "TODO" || task.status === "IN_PROGRESS") ? (
                <>
                  <Button icon={<ClockCircleOutlined />} onClick={() => openAction("reschedule")}>
                    改期
                  </Button>
                  <Button icon={<SwapOutlined />} onClick={() => openAction("reassign")}>
                    转派
                  </Button>
                  <Button danger icon={<StopOutlined />} onClick={() => openAction("cancel")}>
                    取消任务
                  </Button>
                </>
              ) : null}
              {canSupervise && task.activeAlert?.status === "OPEN" ? (
                <Button
                  danger
                  onClick={async () => {
                    try {
                      await handleOverdueAlert(task.activeAlert!.id, task.id);
                      await message.success("逾期提醒已处理");
                      await load();
                    } catch (exception) {
                      await message.error(
                        exception instanceof Error ? exception.message : "处理失败",
                      );
                    }
                  }}
                >
                  处理逾期提醒
                </Button>
              ) : null}
            </div>
          </section>

          <div className={styles.detailGrid}>
            <section className={styles.detailCard}>
              <h2 className={styles.cardTitle}>任务信息</h2>
              <dl className={styles.definitions}>
                <div>
                  <dt>学生</dt>
                  <dd>
                    <Link href={`/workspace/students/${task.student.id}`}>{task.student.name}</Link>
                  </dd>
                </div>
                <div>
                  <dt>执行人</dt>
                  <dd>{task.owner?.displayName ?? "未分配（不可执行）"}</dd>
                </div>
                <div>
                  <dt>当前截止</dt>
                  <dd className={task.isOverdue ? styles.overdue : ""}>{hk(task.currentDueAt)}</dd>
                </div>
                <div>
                  <dt>原始截止</dt>
                  <dd>{hk(task.originalDueAt)}</dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd>{task.progressPercent ?? 0}%</dd>
                </div>
                <div>
                  <dt>所属阶段</dt>
                  <dd>
                    {task.stage.sequenceNo}. {task.stage.name}
                  </dd>
                </div>
              </dl>
            </section>

            <section className={styles.detailCard}>
              <h2 className={styles.cardTitle}>完成标准</h2>
              <p style={{ lineHeight: 1.7 }}>
                {task.completionCriteria || "该任务未设置额外完成标准。"}
              </p>
              <span className={styles.subtle}>标准时限 {task.completionWindowHours} 小时</span>
              {task.completionNote ? (
                <Alert
                  style={{ marginTop: 16 }}
                  type="success"
                  showIcon
                  title="完成说明"
                  description={task.completionNote}
                />
              ) : null}
              {task.cancelReason ? (
                <Alert
                  style={{ marginTop: 16 }}
                  type="warning"
                  showIcon
                  title="取消原因"
                  description={task.cancelReason}
                />
              ) : null}
            </section>

            <section className={`${styles.detailCard} ${styles.wide}`}>
              <h2 className={styles.cardTitle}>任务时间线</h2>
              <div className={styles.timeline}>
                {task.timeline.map((event) => (
                  <article className={styles.timelineItem} key={event.id}>
                    <span className={styles.timelineDot} />
                    <div>
                      <p className={styles.timelineText}>{event.summary}</p>
                      <p className={styles.timelineMeta}>
                        {event.reason ? `${event.reason} · ` : ""}
                        {event.actor?.displayName ?? "系统"}
                        {event.actorRole ? `（${ROLE_LABELS[event.actorRole] ?? "服务人员"}）` : ""}
                      </p>
                    </div>
                    <time className={styles.timelineTime} dateTime={event.createdAt}>
                      {hk(event.createdAt)}
                    </time>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </>
      )}

      <Modal
        open={Boolean(action)}
        title={action ? ACTION_TITLES[action] : ""}
        okText="确认提交"
        cancelText="取消"
        confirmLoading={working}
        destroyOnHidden
        onCancel={() => {
          setAction(undefined);
          form.resetFields();
        }}
        onOk={() => form.submit()}
      >
        {task && action === "reschedule" ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            title={`当前截止：${hk(task.currentDueAt)}`}
            description="提交后会保留原截止时间和改期原因；如任务已不再逾期，当前逾期提醒将自动解除。"
          />
        ) : null}
        {task && action === "reassign" ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="info"
            showIcon
            title={`当前执行人：${task.owner?.displayName ?? "未分配"}`}
            description="提交后，原管家将立即失去该任务的操作权限，新管家立即获得权限。"
          />
        ) : null}
        {task && action === "cancel" ? (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            showIcon
            title="取消后管家不能继续执行该任务"
            description="任务及既有时间线会继续保留，以便后续追溯。"
          />
        ) : null}
        <Form form={form} layout="vertical" onFinish={(values) => void submitAction(values)}>
          {action === "progress" ? (
            <>
              <Form.Item
                name="note"
                label="进展说明"
                rules={[{ required: true, whitespace: true, message: "请填写进展说明" }]}
              >
                <Input.TextArea rows={4} maxLength={2000} showCount />
              </Form.Item>
              <Form.Item name="percent" label="完成百分比（可选）">
                <InputNumber min={0} max={99} precision={0} aria-label="完成百分比" />
              </Form.Item>
            </>
          ) : null}
          {action === "complete" ? (
            <Form.Item
              name="note"
              label="完成说明"
              rules={[{ required: true, whitespace: true, message: "请填写完成说明" }]}
            >
              <Input.TextArea rows={4} maxLength={2000} showCount />
            </Form.Item>
          ) : null}
          {action === "extension" || action === "reschedule" ? (
            <Form.Item
              name="dateTime"
              label={action === "extension" ? "预计完成时间" : "新截止时间"}
              rules={[{ required: true, message: "请选择时间" }]}
            >
              <Input type="datetime-local" />
            </Form.Item>
          ) : null}
          {action === "reassign" ? (
            <Form.Item
              name="ownerId"
              label="新管家"
              rules={[{ required: true, message: "请选择新管家" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={butlers
                  .filter((person) => person.id !== task?.owner?.id)
                  .map((person) => ({ value: person.id, label: person.displayName }))}
              />
            </Form.Item>
          ) : null}
          {action === "extension" ||
          action === "reschedule" ||
          action === "reassign" ||
          action === "cancel" ? (
            <Form.Item
              name="reason"
              label="原因"
              rules={[{ required: true, whitespace: true, message: "请填写原因" }]}
            >
              <Input.TextArea rows={4} maxLength={500} showCount />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </main>
  );
}
