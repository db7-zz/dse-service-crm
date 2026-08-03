"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, App, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import { getResponsiblePersonOptions, listStudents } from "../../../src/students/student-api";
import type { ResponsiblePersonOptions, StudentRecord } from "../../../src/students/student-types";
import {
  getSupervisionSummary,
  handleOverdueAlert,
  listOverdueAlerts,
  listSupervisionTasks,
  type TaskFilters,
} from "../../../src/tasks/task-api";
import type {
  OverdueAlertItem,
  SupervisionSummary,
  TaskPage,
  TaskStatus,
} from "../../../src/tasks/task-types";
import { formatOverdueDuration } from "../../../src/tasks/task-format";
import styles from "../../../src/tasks/task-page.module.css";

const STATUS = {
  TODO: { label: "待开始", color: "default" },
  IN_PROGRESS: { label: "进行中", color: "blue" },
  COMPLETED: { label: "已完成", color: "green" },
  CANCELED: { label: "已取消", color: "default" },
} as const;

const STAGES = [
  ["PROFILE", "建档阶段"],
  ["ASSESSMENT", "学情评估阶段"],
  ["PLANNING", "升学规划阶段"],
  ["MATERIALS", "资料准备阶段"],
  ["ESSAYS", "文书准备阶段"],
  ["SUBMISSION", "申请递交阶段"],
  ["RESULTS", "申请结果跟进阶段"],
  ["ENROLLMENT", "入学确认阶段"],
] as const;

function hk(value: string) {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SupervisionPage() {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<TaskPage>();
  const [summary, setSummary] = useState<SupervisionSummary>();
  const [alerts, setAlerts] = useState<OverdueAlertItem[]>([]);
  const [people, setPeople] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [filters, setFilters] = useState<TaskFilters>({ page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [taskData, summaryData, alertData, options, studentData] = await Promise.all([
        listSupervisionTasks(filters),
        getSupervisionSummary(filters),
        listOverdueAlerts(),
        getResponsiblePersonOptions(),
        listStudents({ page: 1, pageSize: 100 }),
      ]);
      setTasks(taskData);
      setSummary(summaryData);
      setAlerts(alertData.items);
      setPeople(options);
      setStudents(studentData.items);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "监督数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchFilters = (patch: Partial<TaskFilters>) =>
    setFilters((current) => ({ ...current, page: 1, ...patch }));

  const activeMetric = filters.openAlert
    ? "待处理提醒"
    : filters.unassigned
      ? "未分配"
      : filters.overdue
        ? "已逾期"
        : filters.status === "IN_PROGRESS"
          ? "进行中"
          : undefined;
  const activeFilterCount = [
    filters.status,
    filters.ownerId,
    filters.studentId,
    filters.stageCode,
    filters.overdue,
    filters.unassigned,
    filters.openAlert,
    filters.dueFrom,
    filters.dueTo,
  ].filter((value) => value !== undefined && value !== "").length;

  const applyMetric = (metric: "进行中" | "已逾期" | "未分配" | "待处理提醒") => {
    const clear = activeMetric === metric;
    patchFilters({
      status: !clear && metric === "进行中" ? "IN_PROGRESS" : undefined,
      overdue: !clear && metric === "已逾期" ? true : undefined,
      unassigned: !clear && metric === "未分配" ? true : undefined,
      openAlert: !clear && metric === "待处理提醒" ? true : undefined,
    });
  };

  return (
    <PermissionPage permission={PermissionCode.TASK_SUPERVISION_READ}>
      <main className={styles.page}>
        <section className={`${styles.hero} ${styles.compactHero}`}>
          <div>
            <span className={styles.eyebrow}>Task supervision</span>
            <h1 className={styles.title}>任务监督闭环</h1>
            <p className={styles.lead}>
              管理员在同一筛选范围内查看执行进度、逾期、未分配和提醒，并直接进入任务处理。
            </p>
          </div>
          <Button onClick={() => void load()}>刷新实时状态</Button>
        </section>

        <div className={styles.metrics}>
          {[
            ["进行中", summary?.inProgress ?? 0],
            ["已逾期", summary?.overdue ?? 0],
            ["未分配", summary?.unassigned ?? 0],
            ["待处理提醒", summary?.openAlerts ?? 0],
          ].map(([label, value]) => (
            <button
              type="button"
              className={`${styles.metric} ${styles.metricButton}`}
              aria-pressed={activeMetric === label}
              key={label}
              onClick={() => applyMetric(label as "进行中" | "已逾期" | "未分配" | "待处理提醒")}
            >
              <span className={styles.metricValue}>{value}</span>
              <span className={styles.metricLabel}>{label}</span>
            </button>
          ))}
        </div>

        <section className={styles.surface}>
          <div className={styles.filterSummary}>
            <div>
              <strong>任务工作队列</strong>
              <span className={styles.subtle}>
                默认按截止时间从近到远排列，优先处理逾期、待提醒和未分配任务
              </span>
            </div>
            <Button
              disabled={activeFilterCount === 0}
              onClick={() => setFilters({ page: 1, pageSize: filters.pageSize ?? 20 })}
            >
              清除筛选{activeFilterCount > 0 ? `（${activeFilterCount}）` : ""}
            </Button>
          </div>
          <div className={styles.filters}>
            <Select
              allowClear
              placeholder="全部管家"
              value={filters.ownerId}
              onChange={(ownerId) => patchFilters({ ownerId })}
              options={people.butlers.map((person) => ({
                value: person.id,
                label: person.displayName,
              }))}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="全部学生"
              value={filters.studentId}
              onChange={(studentId) => patchFilters({ studentId })}
              options={students.map((student) => ({
                value: student.id,
                label: `${student.name} · ${student.studentNo}`,
              }))}
            />
            <Select
              allowClear
              placeholder="全部阶段"
              value={filters.stageCode}
              onChange={(stageCode) => patchFilters({ stageCode })}
              options={STAGES.map(([value, label], index) => ({
                value,
                label: `${index + 1}. ${label}`,
              }))}
            />
            <Select
              allowClear
              placeholder="全部活动状态"
              value={filters.status}
              onChange={(status: TaskStatus | undefined) => patchFilters({ status })}
              options={Object.entries(STATUS).map(([value, item]) => ({
                value,
                label: item.label,
              }))}
            />
            <Select
              allowClear
              placeholder="逾期状态"
              value={filters.overdue}
              onChange={(overdue) => patchFilters({ overdue })}
              options={[
                { value: true, label: "仅逾期" },
                { value: false, label: "仅未逾期" },
              ]}
            />
            <Select
              allowClear
              placeholder="分配状态"
              value={filters.unassigned}
              onChange={(unassigned) => patchFilters({ unassigned })}
              options={[{ value: true, label: "仅未分配" }]}
            />
            <Input
              type="datetime-local"
              aria-label="截止时间起"
              value={filters.dueFrom?.slice(0, 16) ?? ""}
              onChange={(event) =>
                patchFilters({
                  dueFrom: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : undefined,
                })
              }
            />
            <Input
              type="datetime-local"
              aria-label="截止时间止"
              value={filters.dueTo?.slice(0, 16) ?? ""}
              onChange={(event) =>
                patchFilters({
                  dueTo: event.target.value
                    ? new Date(event.target.value).toISOString()
                    : undefined,
                })
              }
            />
          </div>

          {error ? (
            <Alert
              type="error"
              showIcon
              title="监督数据暂时无法加载"
              description={error}
              action={<Button onClick={() => void load()}>重试</Button>}
            />
          ) : loading ? (
            <Skeleton active paragraph={{ rows: 10 }} />
          ) : !tasks?.items.length ? (
            <Empty description="当前筛选范围内没有任务" />
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>任务 / 学生</th>
                      <th>执行状态</th>
                      <th>截止时间</th>
                      <th>风险与跟进</th>
                      <th>最后更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.items.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <Link className={styles.taskLink} href={`/workspace/tasks/${task.id}`}>
                            {task.title}
                          </Link>
                          <span className={styles.subtle}>
                            {task.student.name} · {task.stage.sequenceNo}. {task.stage.name} ·{" "}
                            {task.sopVersion.displayVersion}
                          </span>
                        </td>
                        <td>
                          <div>{task.owner?.displayName ?? <Tag>未分配</Tag>}</div>
                          <Tag color={STATUS[task.status].color}>{STATUS[task.status].label}</Tag>
                          {task.isOverdue ? <Tag color="red">逾期</Tag> : null}
                          <span className={styles.subtle}>进度 {task.progressPercent ?? 0}%</span>
                        </td>
                        <td className={task.isOverdue ? styles.overdue : ""}>
                          {hk(task.currentDueAt)}
                          {task.isOverdue ? (
                            <span className={styles.subtle}>
                              逾期 {formatOverdueDuration(task.currentDueAt)}
                            </span>
                          ) : null}
                        </td>
                        <td>
                          <div className={styles.riskStack}>
                            {task.activeAlert ? (
                              <Tag color={task.activeAlert.status === "OPEN" ? "red" : "orange"}>
                                第 {task.activeAlert.episode} 次提醒 ·{" "}
                                {task.activeAlert.status === "OPEN" ? "待处理" : "已处理"}
                              </Tag>
                            ) : null}
                            {task.latestExtension ? (
                              <span>
                                延期报备：{task.latestExtension.reason}
                                <span className={styles.subtle}>
                                  预计 {hk(task.latestExtension.expectedFinishAt)}
                                </span>
                              </span>
                            ) : null}
                            {!task.activeAlert && !task.latestExtension ? "—" : null}
                          </div>
                        </td>
                        <td>{hk(task.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <Pagination
                  current={tasks.page}
                  pageSize={tasks.pageSize}
                  total={tasks.total}
                  showSizeChanger={false}
                  onChange={(page) => setFilters((current) => ({ ...current, page }))}
                />
              </div>
            </>
          )}
        </section>

        <section className={styles.surface}>
          <h2 style={{ marginTop: 0 }}>当前逾期提醒</h2>
          <div className={styles.alerts}>
            {alerts.length === 0 ? <Empty description="没有待处理逾期提醒" /> : null}
            {alerts.map((alert) => (
              <div className={styles.alertRow} key={alert.id}>
                <div>
                  <Link className={styles.taskLink} href={`/workspace/tasks/${alert.task.id}`}>
                    {alert.task.student.name} · {alert.task.title}
                  </Link>
                  <span className={styles.subtle}>
                    第 {alert.episode} 次提醒 · {hk(alert.generatedAt)}
                  </span>
                </div>
                <div>
                  <Tag color={alert.status === "OPEN" ? "red" : "orange"}>
                    {alert.status === "OPEN" ? "待处理" : "已处理"}
                  </Tag>
                  {alert.status === "OPEN" ? (
                    <Button
                      size="small"
                      onClick={async () => {
                        try {
                          await handleOverdueAlert(alert.id, alert.task.id);
                          await message.success("逾期提醒已标记处理");
                          await load();
                        } catch (exception) {
                          await message.error(
                            exception instanceof Error ? exception.message : "处理失败",
                          );
                        }
                      }}
                    >
                      标记已处理
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </PermissionPage>
  );
}
