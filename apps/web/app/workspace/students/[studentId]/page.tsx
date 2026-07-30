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
import { Alert, App, Button, Form, Input, Modal, Select, Skeleton, Tooltip } from "antd";
import { ApiClientError } from "@dse/api-client";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../../src/auth/permission-page";
import {
  assignResponsiblePerson,
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
  const { message } = App.useApp();
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
  const [assignmentForm] = Form.useForm<{ userId?: string; reason: string }>();

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
                <Tooltip title="服务启用将在后续 Issue 开放">
                  <Button
                    className={styles.primaryButton}
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    disabled
                  >
                    启用服务
                  </Button>
                </Tooltip>
                <Tooltip title="任务生成后可在此批量分配，功能将在后续 Issue 开放">
                  <Button className={styles.secondaryButton} icon={<UserSwitchOutlined />} disabled>
                    批量分配任务
                  </Button>
                </Tooltip>
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
                    <p className={styles.cardCaption}>后续启用入口已预留</p>
                  </div>
                </div>
                <dl className={styles.definitionGrid}>
                  <div className={styles.definitionItem}>
                    <dt>服务状态</dt>
                    <dd>{student.serviceStatus === "ENABLED" ? "已启用" : "未启用"}</dd>
                  </div>
                  <div className={styles.definitionItem}>
                    <dt>SOP 版本</dt>
                    <dd>{student.sopVersion?.version ?? "尚未套用"}</dd>
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
                </div>
              </section>

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
      </main>
    </PermissionPage>
  );
}
