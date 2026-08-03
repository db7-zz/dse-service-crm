"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Empty, Pagination, Select, Skeleton, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import { listMyTasks } from "../../../src/tasks/task-api";
import type { TaskPage, TaskStatus } from "../../../src/tasks/task-types";
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await listMyTasks({ page, pageSize: 20, status }));
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
                      <th>进度</th>
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
                        <td>{task.progressPercent ?? 0}%</td>
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
      </main>
    </PermissionPage>
  );
}
