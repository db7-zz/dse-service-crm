"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeftOutlined,
  EditOutlined,
  PlusOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Tag,
} from "antd";
import { ApiClientError } from "@dse/api-client";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../../src/auth/permission-page";
import { useAuth } from "../../../../src/auth/auth-context";
import {
  assignResponsiblePerson,
  activateStudentService,
  bulkAssignStudentTasks,
  createManualTask,
  getResponsiblePersonOptions,
  getStudent,
  getStudentServiceProgress,
  recalculateServiceProgress,
} from "../../../../src/students/student-api";
import type {
  ResponsiblePersonOptions,
  StudentDetail,
  StudentPerson,
} from "../../../../src/students/student-types";
import styles from "../../../../src/students/student-page.module.css";

type AssignmentType = "default-butler" | "planner";

function PersonIdentity({ person }: { person: StudentPerson | null }) {
  if (!person) {
    return (
      <>
        <span className={styles.avatar} aria-hidden>
          ?
        </span>
        <span className={styles.ownerName}>暂未分配</span>
      </>
    );
  }
  return (
    <>
      <span className={styles.avatar} aria-hidden>
        {person.displayName.slice(0, 1)}
      </span>
      <span className={styles.ownerName}>{person.displayName}</span>
    </>
  );
}

function formatHongKongTime(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatStageDuration(startedAt: string | null, completedAt: string | null) {
  if (!startedAt) return null;
  const milliseconds = Math.max(
    0,
    (completedAt ? new Date(completedAt).getTime() : Date.now()) - new Date(startedAt).getTime(),
  );
  if (milliseconds < 60_000) return "不足1分钟";
  const totalMinutes = Math.floor(milliseconds / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours > 0 ? `${hours}小时` : ""}`;
  if (hours > 0) return `${hours}小时${minutes > 0 ? `${minutes}分钟` : ""}`;
  return `${minutes}分钟`;
}

export default function StudentDetailPage() {
  const { message, modal } = App.useApp();
  const { user } = useAuth();
  const administratorView = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_READ));
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const returnedStageId = searchParams.get("stage");
  const requestedListReturnTo = searchParams.get("returnTo");
  const listReturnTo = requestedListReturnTo?.startsWith("/workspace/students")
    ? requestedListReturnTo
    : "/workspace/students";
  const studentId = params.studentId;
  const [student, setStudent] = useState<StudentDetail>();
  const [options, setOptions] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [stageError, setStageError] = useState<string>();
  const [assignmentType, setAssignmentType] = useState<AssignmentType>();
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [manualTaskOpen, setManualTaskOpen] = useState(false);
  const [manualTaskConflict, setManualTaskConflict] = useState(false);
  const [expandedStageIds, setExpandedStageIds] = useState<string[]>([]);
  const [assignmentForm] = Form.useForm<{ userId?: string; reason: string }>();
  const [bulkAssignForm] = Form.useForm<{
    butlerId: string;
    reason: string;
    taskIds: string[];
  }>();
  const [manualTaskForm] = Form.useForm<{
    stageInstanceId: string;
    title: string;
    description?: string;
    completionCriteria?: string;
    currentDueAt: { toDate(): Date };
    ownerId?: string;
    isBlocking: boolean;
  }>();
  const manualTaskStageId = Form.useWatch("stageInstanceId", manualTaskForm);
  const manualTaskStage = student?.stages.find((stage) => stage.id === manualTaskStageId);
  const selectedBulkTaskIds = Form.useWatch("taskIds", bulkAssignForm) ?? [];
  const selectedBulkButlerId = Form.useWatch("butlerId", bulkAssignForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    setStageError(undefined);
    try {
      const studentData = await getStudent(studentId, !administratorView);
      const [progressResult, peopleResult] = await Promise.allSettled([
        getStudentServiceProgress(studentId, !administratorView),
        administratorView
          ? getResponsiblePersonOptions()
          : Promise.resolve({ butlers: [], planners: [] }),
      ]);
      const nextStudent =
        progressResult.status === "fulfilled"
          ? {
              ...studentData,
              activation: progressResult.value.activation,
              sopVersion: progressResult.value.sopVersion,
              taskSummary: progressResult.value.taskSummary,
              progress: progressResult.value.progress,
              stages: progressResult.value.stages,
            }
          : { ...studentData, stages: [] };
      setStudent(nextStudent);
      if (progressResult.status === "rejected") {
        setStageError(
          progressResult.reason instanceof Error
            ? progressResult.reason.message
            : "八阶段服务进度加载失败",
        );
      }
      setOptions(
        peopleResult.status === "fulfilled" ? peopleResult.value : { butlers: [], planners: [] },
      );
      setExpandedStageIds((current) =>
        current.length > 0
          ? current
          : returnedStageId
            ? [returnedStageId]
            : nextStudent.progress?.currentStage
              ? [nextStudent.progress.currentStage.id]
              : [],
      );
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "学生详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [administratorView, returnedStageId, studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadProgress = useCallback(async () => {
    if (!student) return;
    setStageError(undefined);
    try {
      const progress = await getStudentServiceProgress(studentId, !administratorView);
      setStudent((current) =>
        current
          ? {
              ...current,
              activation: progress.activation,
              sopVersion: progress.sopVersion,
              taskSummary: progress.taskSummary,
              progress: progress.progress,
              stages: progress.stages,
            }
          : current,
      );
    } catch (exception) {
      setStageError(exception instanceof Error ? exception.message : "八阶段服务进度加载失败");
    }
  }, [administratorView, student, studentId]);

  const openAssignment = (type: AssignmentType) => {
    if (!student) return;
    setConflict(false);
    setAssignmentType(type);
    assignmentForm.setFieldsValue({
      userId: type === "default-butler" ? student.defaultButler?.id : student.planner?.id,
      reason: "",
    });
  };

  const assignmentLabel = assignmentType === "default-butler" ? "默认管家" : "规划老师";
  const assignmentOptions =
    assignmentType === "default-butler" ? options.butlers : options.planners;
  const unassignedTasks =
    student?.stages.flatMap((stage) =>
      stage.tasks
        .filter((task) => !task.owner && (task.status === "TODO" || task.status === "IN_PROGRESS"))
        .map((task) => ({ ...task, stageName: stage.name })),
    ) ?? [];
  const selectedBulkButler = options.butlers.find((person) => person.id === selectedBulkButlerId);
  const progressUnavailable = Boolean(
    student?.progress && student.progress.calculationStatus !== "NORMAL",
  );
  const studentReturnPath = `/workspace/students/${studentId}?returnTo=${encodeURIComponent(
    listReturnTo,
  )}`;

  return (
    <PermissionPage
      anyPermissions={[PermissionCode.STUDENTS_READ, PermissionCode.STUDENTS_OWN_READ]}
    >
      <main className={styles.page}>
        <Link href={listReturnTo} className={styles.backLink}>
          <ArrowLeftOutlined aria-hidden />
          返回学生列表
        </Link>

        {error ? (
          <Alert
            type="error"
            showIcon
            title="学生详情暂时无法加载"
            description={error}
            action={<Button onClick={() => void load()}>重试</Button>}
          />
        ) : loading || !student ? (
          <section className={styles.compactHero}>
            <Skeleton active avatar paragraph={{ rows: 5 }} />
          </section>
        ) : (
          <>
            <section className={styles.compactHero}>
              <div className={styles.detailHeaderRow}>
                <div className={styles.identity}>
                  <div className={styles.identityAvatar} aria-hidden>
                    {student.name.slice(0, 1)}
                  </div>
                  <div>
                    <span className={styles.eyebrow}>Student profile</span>
                    <h1 className={styles.compactTitle}>{student.name}</h1>
                    <p className={styles.studentNumber}>{student.studentNo}</p>
                  </div>
                </div>
                <span
                  className={`${styles.statusPill} ${
                    student.serviceStatus === "ENABLED" ? styles.statusPillEnabled : ""
                  }`}
                >
                  <span className={styles.statusDot} aria-hidden />
                  服务
                  {{
                    NOT_ENABLED: "未启用",
                    ENABLED: "已启用",
                    PAUSED: "已暂停",
                    TERMINATED: "已终止",
                  }[student.serviceStatus] ?? student.serviceStatus}
                </span>
              </div>
              {administratorView ? (
                <div className={styles.detailActions}>
                  <Link href={`/workspace/students/${student.id}/record`}>
                    <Button className={styles.secondaryButton}>完整档案</Button>
                  </Link>
                  <Link href={`/workspace/students/${student.id}/edit`}>
                    <Button className={styles.secondaryButton} icon={<EditOutlined />}>
                      编辑资料
                    </Button>
                  </Link>
                  <Button
                    className={styles.primaryButton}
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    disabled={student.serviceStatus !== "NOT_ENABLED"}
                    loading={submitting}
                    onClick={() =>
                      modal.confirm({
                        title: `为 ${student.name} 启用服务？`,
                        content:
                          "系统会使用当前已发布 SOP，一次生成八个阶段和全部任务。该操作不能重复执行。",
                        okText: "确认启用",
                        cancelText: "取消",
                        onOk: async () => {
                          setSubmitting(true);
                          try {
                            await activateStudentService(student.id, student.version);
                            await message.success("服务已启用，阶段和任务已生成");
                            await load();
                          } catch (exception) {
                            await message.error(
                              exception instanceof Error ? exception.message : "服务启用失败",
                            );
                          } finally {
                            setSubmitting(false);
                          }
                        },
                      })
                    }
                  >
                    {student.serviceStatus === "NOT_ENABLED" ? "启用服务" : "服务已经初始化"}
                  </Button>
                  <Button
                    className={styles.secondaryButton}
                    icon={<UserSwitchOutlined />}
                    disabled={unassignedTasks.length === 0}
                    onClick={() => {
                      setBulkAssignOpen(true);
                      bulkAssignForm.setFieldsValue({
                        butlerId: student.defaultButler?.id,
                        reason: "管理员批量分配学生未分配任务",
                        taskIds: unassignedTasks.map((task) => task.id),
                      });
                    }}
                  >
                    批量分配任务（{unassignedTasks.length}）
                  </Button>
                  <Button
                    className={styles.secondaryButton}
                    icon={<PlusOutlined />}
                    disabled={student.serviceStatus !== "ENABLED" || progressUnavailable}
                    onClick={() => {
                      const defaultStage =
                        student.progress?.currentStage ??
                        student.stages.find((stage) => stage.status !== "COMPLETED") ??
                        student.stages[student.stages.length - 1];
                      if (!defaultStage) return;
                      manualTaskForm.setFieldsValue({
                        stageInstanceId: defaultStage.id,
                        isBlocking: false,
                        ownerId: student.defaultButler?.id,
                      });
                      setManualTaskConflict(false);
                      setManualTaskOpen(true);
                    }}
                  >
                    新建临时任务
                  </Button>
                </div>
              ) : (
                <div className={styles.detailActions}>
                  <Link href={`/workspace/students/${student.id}/record`}>
                    <Button className={styles.secondaryButton}>完整档案</Button>
                  </Link>
                </div>
              )}
            </section>

            {student.progress && student.progress.calculationStatus !== "NORMAL" ? (
              <Alert
                type={
                  administratorView && student.progress?.calculationStatus === "ERROR"
                    ? "error"
                    : "info"
                }
                showIcon
                title={
                  administratorView && student.progress?.calculationStatus === "ERROR"
                    ? "服务进度数据异常"
                    : "服务进度更新中"
                }
                description={
                  administratorView && student.progress?.calculationStatus === "ERROR"
                    ? `错误追踪：${student.progress.calculationErrorCode ?? "未知"}；最近计算：${
                        student.progress.lastCalculatedAt
                          ? formatHongKongTime(student.progress.lastCalculatedAt)
                          : "暂无"
                      }。重算只修复阶段状态，不修改任务事实。`
                    : "服务团队正在处理进度数据，任务原始记录不受影响。"
                }
                action={
                  administratorView && student.progress?.calculationStatus === "ERROR" ? (
                    <Button
                      loading={submitting}
                      onClick={async () => {
                        setSubmitting(true);
                        try {
                          await recalculateServiceProgress(student.id);
                          await message.success("服务进度重算完成");
                          await load();
                        } catch (exception) {
                          await message.error(
                            exception instanceof Error ? exception.message : "重算失败",
                          );
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      受控重算
                    </Button>
                  ) : undefined
                }
              />
            ) : null}

            <div className={styles.detailGrid}>
              {administratorView ? (
                <>
                  <section className={styles.detailCard}>
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.cardTitle}>基本资料</h2>
                        <p className={styles.cardCaption}>最小建档信息</p>
                      </div>
                    </div>
                    <dl className={styles.definitionGrid}>
                      <div className={styles.definitionItem}>
                        <dt>联系电话</dt>
                        <dd>
                          {student.phone ? (
                            <a href={`tel:${student.phone}`}>{student.phone}</a>
                          ) : (
                            "未填写"
                          )}
                        </dd>
                      </div>
                      <div className={styles.definitionItem}>
                        <dt>联系邮箱</dt>
                        <dd>
                          {student.email ? (
                            <a href={`mailto:${student.email}`}>{student.email}</a>
                          ) : (
                            "未填写"
                          )}
                        </dd>
                      </div>
                      <div className={styles.definitionItem}>
                        <dt>建档人</dt>
                        <dd>{student.createdBy?.displayName ?? "—"}</dd>
                      </div>
                      <div className={styles.definitionItem}>
                        <dt>最近更新</dt>
                        <dd>{formatHongKongTime(student.updatedAt)}</dd>
                      </div>
                    </dl>
                  </section>

                  <section className={styles.detailCard}>
                    <div className={styles.cardHeader}>
                      <div>
                        <h2 className={styles.cardTitle}>负责人</h2>
                        <p className={styles.cardCaption}>更换默认管家不会自动转派已有任务</p>
                      </div>
                    </div>
                    <div className={styles.ownerGrid}>
                      <div className={styles.ownerCard}>
                        <span className={styles.ownerLabel}>默认管家</span>
                        <PersonIdentity person={student.defaultButler} />
                        <Button
                          type="link"
                          icon={<SwapOutlined />}
                          onClick={() => openAssignment("default-butler")}
                        >
                          {student.defaultButler ? "更换" : "分配"}
                        </Button>
                      </div>
                      <div className={styles.ownerCard}>
                        <span className={styles.ownerLabel}>规划老师</span>
                        <PersonIdentity person={student.planner ?? null} />
                        <Button
                          type="link"
                          icon={<SwapOutlined />}
                          onClick={() => openAssignment("planner")}
                        >
                          {student.planner ? "更换" : "分配"}
                        </Button>
                      </div>
                    </div>
                  </section>
                </>
              ) : null}

              <section className={styles.detailCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>服务与 SOP</h2>
                    <p className={styles.cardCaption}>启用后固定使用当时发布的版本快照</p>
                  </div>
                </div>
                <dl className={styles.definitionGrid}>
                  <div className={styles.definitionItem}>
                    <dt>服务状态</dt>
                    <dd>{student.serviceStatus === "ENABLED" ? "已启用" : "未启用"}</dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>SOP 版本</dt>
                    <dd>{student.sopVersion?.displayVersion ?? "尚未套用"}</dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>当前阶段</dt>
                    <dd>
                      {student.serviceStatus !== "ENABLED"
                        ? "服务未启用"
                        : progressUnavailable
                          ? "进度更新中"
                          : (student.progress?.currentStage?.name ?? "全部阶段已完成")}
                    </dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>阶段进度</dt>
                    <dd>
                      {student.progress && !progressUnavailable
                        ? `${student.progress.completedStageCount}/${student.progress.totalStageCount}`
                        : "—"}
                    </dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>当前阻塞</dt>
                    <dd>
                      {!progressUnavailable
                        ? (student.progress?.currentBlockingTaskCount ?? "—")
                        : "—"}
                    </dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>前序遗留</dt>
                    <dd>
                      {!progressUnavailable ? (student.progress?.legacyTaskCount ?? "—") : "—"}
                    </dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>全部逾期</dt>
                    <dd>{student.taskSummary.overdue}</dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>任务完成率</dt>
                    <dd>
                      {student.taskSummary.completionRate === null
                        ? "—"
                        : `${Math.round(student.taskSummary.completionRate * 100)}%`}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className={styles.detailCard}>
                <div className={styles.cardHeader}>
                  <div>
                    <h2 className={styles.cardTitle}>任务摘要</h2>
                    <p className={styles.cardCaption}>启用服务后显示实时任务数据</p>
                  </div>
                </div>
                <div className={styles.taskMetrics}>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.total}</span>
                    <span className={styles.metricLabel}>全部任务</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.inProgress}</span>
                    <span className={styles.metricLabel}>进行中</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.unassigned}</span>
                    <span className={styles.metricLabel}>待分配</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.overdue}</span>
                    <span className={styles.metricLabel}>已逾期</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.completed}</span>
                    <span className={styles.metricLabel}>已完成</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>{student.taskSummary.todo}</span>
                    <span className={styles.metricLabel}>待开始</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricValue}>
                      {student.taskSummary.completionRate === null
                        ? "—"
                        : `${Math.round(student.taskSummary.completionRate * 100)}%`}
                    </span>
                    <span className={styles.metricLabel}>任务完成率</span>
                  </div>
                </div>
              </section>

              {stageError ? (
                <section className={`${styles.detailCard} ${styles.detailCardWide}`}>
                  <Alert
                    type="error"
                    showIcon
                    title="八阶段服务进度暂时无法加载"
                    description={stageError}
                    action={<Button onClick={() => void reloadProgress()}>重新加载</Button>}
                  />
                </section>
              ) : student.stages.length > 0 ? (
                <section className={`${styles.detailCard} ${styles.detailCardWide}`}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h2 className={styles.cardTitle}>八阶段任务</h2>
                      <p className={styles.cardCaption}>
                        阻塞任务全部完成或取消后自动推进；后续阶段任务仍可提前执行
                      </p>
                    </div>
                  </div>
                  <div className={styles.stageInstances}>
                    {student.stages.map((stage) => {
                      const expanded = expandedStageIds.includes(stage.id);
                      const statusLabel = progressUnavailable
                        ? "状态校验中"
                        : stage.status === "COMPLETED"
                          ? "已完成"
                          : stage.status === "IN_PROGRESS"
                            ? "进行中"
                            : "未开始";
                      const duration = progressUnavailable
                        ? null
                        : formatStageDuration(stage.startedAt, stage.completedAt);
                      return (
                        <article className={styles.stageInstance} key={stage.id}>
                          <button
                            type="button"
                            className={styles.stageInstanceHeader}
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedStageIds((current) =>
                                expanded
                                  ? current.filter((id) => id !== stage.id)
                                  : [...current, stage.id],
                              )
                            }
                          >
                            <span className={styles.stageIndex}>{stage.sequenceNo}</span>
                            <strong>{stage.name}</strong>
                            <Tag
                              color={
                                progressUnavailable
                                  ? "orange"
                                  : stage.status === "COMPLETED"
                                    ? "green"
                                    : stage.status === "IN_PROGRESS"
                                      ? "blue"
                                      : "default"
                              }
                            >
                              {statusLabel}
                            </Tag>
                            <span className={styles.secondaryText}>
                              {stage.openBlockingTaskCount} 项阻塞未完成 · {stage.tasks.length}{" "}
                              项任务
                            </span>
                          </button>
                          <div className={styles.secondaryText}>
                            {progressUnavailable
                              ? "阶段状态与时间暂不展示；任务原始事实仍可查看"
                              : stage.startedAt
                                ? `开始 ${formatHongKongTime(stage.startedAt)}`
                                : "尚未开始"}
                            {!progressUnavailable && stage.completedAt
                              ? ` · 完成 ${formatHongKongTime(stage.completedAt)}`
                              : ""}
                            {duration ? ` · 耗时 ${duration}` : ""}
                            {!progressUnavailable && stage.completionReason
                              ? ` · ${stage.completionReason}`
                              : ""}
                          </div>
                          {expanded ? (
                            <>
                              <div className={styles.stageTaskList}>
                                {stage.tasks.map((task) => (
                                  <div className={styles.stageTask} key={task.id}>
                                    <Link
                                      href={`/workspace/tasks/${task.id}?returnTo=${encodeURIComponent(
                                        studentReturnPath,
                                      )}&stage=${stage.id}`}
                                    >
                                      {task.title}
                                    </Link>
                                    <span>{task.owner?.displayName ?? "未分配"}</span>
                                    <span>
                                      <Tag color={task.isBlocking ? "gold" : "default"}>
                                        {task.isBlocking ? "阻塞任务" : "非阻塞任务"}
                                      </Tag>
                                      {task.sourceType === "MANUAL" ? <Tag>临时任务</Tag> : null}
                                      {task.isLegacy ? <Tag color="orange">前序遗留</Tag> : null}
                                    </span>
                                    <Tag
                                      color={
                                        task.isOverdue
                                          ? "red"
                                          : task.status === "COMPLETED"
                                            ? "green"
                                            : "blue"
                                      }
                                    >
                                      {task.isOverdue
                                        ? "逾期"
                                        : task.status === "TODO"
                                          ? "待开始"
                                          : task.status === "IN_PROGRESS"
                                            ? "进行中"
                                            : task.status === "COMPLETED"
                                              ? "已完成"
                                              : "已取消"}
                                    </Tag>
                                  </div>
                                ))}
                              </div>
                              {stage.transitions.length > 0 ? (
                                <div className={styles.timeline}>
                                  {stage.transitions.map((transition) => (
                                    <article className={styles.timelineItem} key={transition.id}>
                                      <span className={styles.timelineDot} aria-hidden />
                                      <div>
                                        <p className={styles.timelineText}>{transition.summary}</p>
                                        <p className={styles.timelineMeta}>
                                          {formatHongKongTime(transition.createdAt)}
                                          {transition.triggerTask
                                            ? ` · 触发任务：${transition.triggerTask.title}`
                                            : ""}
                                        </p>
                                      </div>
                                    </article>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {administratorView ? (
                <section className={`${styles.detailCard} ${styles.detailCardWide}`}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h2 className={styles.cardTitle}>负责人变更记录</h2>
                      <p className={styles.cardCaption}>保留前后值、原因、操作者与香港时间</p>
                    </div>
                  </div>
                  {student.responsibilityHistory.length === 0 ? (
                    <p className={styles.unassigned}>尚无负责人变更记录。</p>
                  ) : (
                    <div className={styles.timeline}>
                      {student.responsibilityHistory.map((change) => (
                        <article className={styles.timelineItem} key={change.id}>
                          <span className={styles.timelineDot} aria-hidden />
                          <div>
                            <p className={styles.timelineText}>
                              <strong>
                                {change.responsibilityType === "DEFAULT_BUTLER"
                                  ? "默认管家"
                                  : "规划老师"}
                              </strong>
                              ：{change.previousUser?.displayName ?? "未分配"} →{" "}
                              {change.newUser?.displayName ?? "未分配"}
                            </p>
                            <p className={styles.timelineMeta}>
                              {change.reason} · 操作人 {change.operator.displayName}
                            </p>
                          </div>
                          <time className={styles.timelineTime} dateTime={change.createdAt}>
                            {formatHongKongTime(change.createdAt)}
                          </time>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </>
        )}

        <Modal
          open={manualTaskOpen}
          title="新建临时任务"
          okText="创建任务"
          cancelText="取消"
          confirmLoading={submitting}
          forceRender
          destroyOnHidden
          onCancel={() => {
            setManualTaskOpen(false);
            setManualTaskConflict(false);
          }}
          onOk={() => manualTaskForm.submit()}
        >
          <Alert
            type="info"
            showIcon
            title="临时任务负责角色固定为管家"
            description="默认不阻塞阶段；阻塞属性创建后不可修改。已完成阶段只能新增非阻塞跟进任务。"
            style={{ marginBottom: 16 }}
          />
          {manualTaskConflict ? (
            <Alert
              type="warning"
              showIcon
              title="阶段状态已变化"
              description="表单内容已保留。请重新加载阶段状态后再次确认阻塞属性。"
              action={<Button onClick={() => void reloadProgress()}>重新加载</Button>}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form
            form={manualTaskForm}
            layout="vertical"
            onFinish={async (values) => {
              if (!student || !manualTaskStage) return;
              setSubmitting(true);
              try {
                const dueAt = values.currentDueAt.toDate();
                dueAt.setSeconds(0, 0);
                await createManualTask({
                  studentId: student.id,
                  stageInstanceId: manualTaskStage.id,
                  title: values.title,
                  description: values.description,
                  completionCriteria: values.completionCriteria,
                  currentDueAt: dueAt.toISOString(),
                  ownerId: values.ownerId,
                  isBlocking: Boolean(values.isBlocking),
                  stageVersion: manualTaskStage.version,
                });
                setManualTaskOpen(false);
                setManualTaskConflict(false);
                manualTaskForm.resetFields();
                setExpandedStageIds((current) =>
                  current.includes(manualTaskStage.id) ? current : [...current, manualTaskStage.id],
                );
                await message.success("临时任务已创建");
                await load();
              } catch (exception) {
                const conflictError =
                  exception instanceof ApiClientError &&
                  exception.envelope?.success === false &&
                  [
                    "STAGE_VERSION_CONFLICT",
                    "STAGE_ALREADY_COMPLETED",
                    "SERVICE_PROGRESS_RECALCULATING",
                    "SERVICE_PROGRESS_INCONSISTENT",
                  ].includes(exception.envelope.error.code);
                setManualTaskConflict(conflictError);
                await message[conflictError ? "warning" : "error"](
                  exception instanceof Error ? exception.message : "临时任务创建失败",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              name="stageInstanceId"
              label="所属阶段"
              rules={[{ required: true, message: "请选择所属阶段" }]}
            >
              <Select
                onChange={(stageId: string) => {
                  const selectedStage = student?.stages.find((stage) => stage.id === stageId);
                  if (
                    selectedStage?.status === "COMPLETED" ||
                    student?.progress?.completedStageCount === 8
                  ) {
                    manualTaskForm.setFieldValue("isBlocking", false);
                  }
                }}
                options={student?.stages.map((stage) => ({
                  value: stage.id,
                  label: `${String(stage.sequenceNo).padStart(2, "0")} ${stage.name} · ${
                    stage.status === "COMPLETED"
                      ? "已完成"
                      : stage.status === "IN_PROGRESS"
                        ? "进行中"
                        : "未开始"
                  }`,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="title"
              label="任务名称"
              rules={[{ required: true, whitespace: true, message: "请输入任务名称" }]}
            >
              <Input maxLength={150} />
            </Form.Item>
            <Form.Item name="description" label="任务说明">
              <Input.TextArea maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} />
            </Form.Item>
            <Form.Item name="completionCriteria" label="完成标准">
              <Input.TextArea maxLength={2000} autoSize={{ minRows: 2, maxRows: 5 }} />
            </Form.Item>
            <Form.Item
              name="currentDueAt"
              label="当前截止时间"
              rules={[{ required: true, message: "请选择截止时间" }]}
            >
              <DatePicker showTime={{ format: "HH:mm" }} format="YYYY-MM-DD HH:mm" />
            </Form.Item>
            <Form.Item name="ownerId" label="负责人（可留空待分配）">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={options.butlers.map((person) => ({
                  value: person.id,
                  label: person.displayName,
                }))}
              />
            </Form.Item>
            <Form.Item name="isBlocking" label="是否阻塞阶段" valuePropName="checked">
              <Switch
                disabled={
                  manualTaskStage?.status === "COMPLETED" ||
                  student?.progress?.completedStageCount === 8
                }
                checkedChildren="阻塞"
                unCheckedChildren="非阻塞"
              />
            </Form.Item>
            {manualTaskStage?.status === "COMPLETED" ? (
              <p className={styles.secondaryText}>已完成阶段只能新增非阻塞跟进任务。</p>
            ) : null}
          </Form>
        </Modal>

        <Modal
          open={Boolean(assignmentType)}
          title={`调整${assignmentLabel}`}
          okText="保存变更"
          cancelText="取消"
          confirmLoading={submitting}
          forceRender
          destroyOnHidden
          onCancel={() => {
            setAssignmentType(undefined);
            setConflict(false);
          }}
          onOk={() => assignmentForm.submit()}
        >
          {conflict ? (
            <Alert
              className={styles.conflict}
              type="warning"
              showIcon
              title="负责人关系已被其他操作更新"
              description="点击刷新后，已填写的变更原因会保留。"
              action={
                <Button
                  onClick={async () => {
                    await load();
                    setConflict(false);
                  }}
                >
                  刷新
                </Button>
              }
            />
          ) : null}
          <Form
            form={assignmentForm}
            layout="vertical"
            preserve
            onFinish={async (values) => {
              if (!assignmentType || !student) return;
              setSubmitting(true);
              setConflict(false);
              try {
                await assignResponsiblePerson({
                  studentId: student.id,
                  type: assignmentType,
                  userId: values.userId ?? null,
                  reason: values.reason,
                  version: student.version,
                });
                await message.success(`${assignmentLabel}已更新`);
                setAssignmentType(undefined);
                assignmentForm.resetFields();
                await load();
              } catch (exception) {
                if (exception instanceof ApiClientError && exception.status === 409) {
                  setConflict(true);
                } else {
                  await message.error(
                    exception instanceof Error ? exception.message : "负责人更新失败",
                  );
                }
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item label={assignmentLabel} name="userId">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder={`暂不分配${assignmentLabel}`}
                options={assignmentOptions.map((person) => ({
                  value: person.id,
                  label: person.displayName,
                }))}
                notFoundContent={`暂无可用${assignmentLabel}`}
              />
            </Form.Item>
            <Form.Item
              label="变更原因"
              name="reason"
              rules={[
                { required: true, whitespace: true, message: "请填写变更原因" },
                { max: 500, message: "变更原因不能超过500个字符" },
              ]}
            >
              <Input.TextArea
                rows={4}
                maxLength={500}
                showCount
                placeholder="说明本次分配、更换或取消分配的原因"
              />
            </Form.Item>
          </Form>
        </Modal>

        <Modal
          open={bulkAssignOpen}
          title="批量分配未分配任务"
          okText={`确认分配 ${selectedBulkTaskIds.length} 项`}
          cancelText="取消"
          confirmLoading={submitting}
          forceRender
          destroyOnHidden
          onCancel={() => setBulkAssignOpen(false)}
          onOk={() => bulkAssignForm.submit()}
        >
          <Alert
            style={{ marginBottom: 18 }}
            type="info"
            showIcon
            title="批量操作采用全有或全无"
            description="如任一任务在提交前已被分配或版本改变，整批操作会被拒绝并列出冲突。"
          />
          <Alert
            style={{ marginBottom: 18 }}
            type={selectedBulkTaskIds.length > 0 && selectedBulkButler ? "success" : "warning"}
            showIcon
            title={
              selectedBulkTaskIds.length > 0 && selectedBulkButler
                ? `即将把 ${selectedBulkTaskIds.length} 项任务分配给 ${selectedBulkButler.displayName}`
                : "请选择管家和至少一项任务"
            }
            description="提交前请核对任务数量、执行人和分配原因。"
          />
          <Form
            form={bulkAssignForm}
            layout="vertical"
            onFinish={async (values) => {
              if (!student) return;
              setSubmitting(true);
              try {
                await bulkAssignStudentTasks({
                  studentId: student.id,
                  butlerId: values.butlerId,
                  reason: values.reason,
                  tasks: unassignedTasks
                    .filter((task) => values.taskIds.includes(task.id))
                    .map((task) => ({ taskId: task.id, version: task.version })),
                });
                await message.success("任务已批量分配");
                setBulkAssignOpen(false);
                await load();
              } catch (exception) {
                await message.error(
                  exception instanceof Error ? exception.message : "批量分配失败",
                );
                await load();
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              name="butlerId"
              label="分配给"
              rules={[{ required: true, message: "请选择管家" }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                options={options.butlers.map((person) => ({
                  value: person.id,
                  label: person.displayName,
                }))}
              />
            </Form.Item>
            <Form.Item
              name="taskIds"
              label="选择任务"
              rules={[{ required: true, message: "至少选择一项任务" }]}
            >
              <Checkbox.Group style={{ display: "grid", gap: 10 }}>
                {unassignedTasks.map((task) => (
                  <Checkbox value={task.id} key={task.id}>
                    {task.stageName} · {task.title}
                  </Checkbox>
                ))}
              </Checkbox.Group>
            </Form.Item>
            <Form.Item
              name="reason"
              label="分配原因"
              rules={[{ required: true, whitespace: true, message: "请填写分配原因" }]}
            >
              <Input.TextArea rows={3} maxLength={500} showCount />
            </Form.Item>
          </Form>
        </Modal>
      </main>
    </PermissionPage>
  );
}
