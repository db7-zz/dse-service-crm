"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeftOutlined,
  EditOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Checkbox, Form, Input, Modal, Select, Skeleton, Tag } from "antd";
import { ApiClientError } from "@dse/api-client";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../../src/auth/permission-page";
import {
  assignResponsiblePerson,
  activateStudentService,
  bulkAssignStudentTasks,
  getResponsiblePersonOptions,
  getStudent,
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

export default function StudentDetailPage() {
  const { message, modal } = App.useApp();
  const params = useParams<{ studentId: string }>();
  const studentId = params.studentId;
  const [student, setStudent] = useState<StudentDetail>();
  const [options, setOptions] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [assignmentType, setAssignmentType] = useState<AssignmentType>();
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [assignmentForm] = Form.useForm<{ userId?: string; reason: string }>();
  const [bulkAssignForm] = Form.useForm<{
    butlerId: string;
    reason: string;
    taskIds: string[];
  }>();
  const selectedBulkTaskIds = Form.useWatch("taskIds", bulkAssignForm) ?? [];
  const selectedBulkButlerId = Form.useWatch("butlerId", bulkAssignForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [studentData, responsiblePeople] = await Promise.all([
        getStudent(studentId),
        getResponsiblePersonOptions(),
      ]);
      setStudent(studentData);
      setOptions(responsiblePeople);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "学生详情加载失败");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <PermissionPage permission={PermissionCode.STUDENTS_READ}>
      <main className={styles.page}>
        <Link href="/workspace/students" className={styles.backLink}>
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
                  服务{student.serviceStatus === "ENABLED" ? "已启用" : "未启用"}
                </span>
              </div>
              <div className={styles.detailActions}>
                <Link href={`/workspace/students/${student.id}/edit`}>
                  <Button className={styles.secondaryButton} icon={<EditOutlined />}>
                    编辑资料
                  </Button>
                </Link>
                <Button
                  className={styles.primaryButton}
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={student.serviceStatus === "ENABLED"}
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
                  {student.serviceStatus === "ENABLED" ? "服务已启用" : "启用服务"}
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
              </div>
            </section>

            <div className={styles.detailGrid}>
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
                    <dd>{student.createdBy.displayName}</dd>
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
                    <PersonIdentity person={student.planner} />
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
                </div>
              </section>

              {student.stages.length > 0 ? (
                <section className={`${styles.detailCard} ${styles.detailCardWide}`}>
                  <div className={styles.cardHeader}>
                    <div>
                      <h2 className={styles.cardTitle}>八阶段任务</h2>
                      <p className={styles.cardCaption}>阶段实例只用于组织和筛选，不设置状态</p>
                    </div>
                  </div>
                  <div className={styles.stageInstances}>
                    {student.stages.map((stage) => (
                      <article className={styles.stageInstance} key={stage.id}>
                        <div className={styles.stageInstanceHeader}>
                          <span className={styles.stageIndex}>{stage.sequenceNo}</span>
                          <strong>{stage.name}</strong>
                          <span className={styles.secondaryText}>{stage.tasks.length} 项任务</span>
                        </div>
                        <div className={styles.stageTaskList}>
                          {stage.tasks.map((task) => (
                            <div className={styles.stageTask} key={task.id}>
                              <Link href={`/workspace/tasks/${task.id}`}>{task.title}</Link>
                              <span>{task.owner?.displayName ?? "未分配"}</span>
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
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

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
            </div>
          </>
        )}

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
