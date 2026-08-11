"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { listStudents } from "../students/student-api";
import type { StudentRecord } from "../students/student-types";
import {
  ApplicationFiltersBar,
  ApplicationStatusTag,
  AttentionBadge,
  CreateApplicationModal,
} from "./application-components";
import { RISK_META, RISK_ORDER, STAGE_META, STAGE_ORDER, formatDateTime } from "./application-meta";
import {
  getApplication,
  getApplicationDashboard,
  type ApplicationDashboardFilters,
} from "./operations-api";
import type {
  ApplicationDashboardView,
  ApplicationStageCode,
  ApplicationSummaryMetric,
  StudentApplicationSummaryView,
} from "./operations-types";

export function ApplicationsDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [filters, setFilters] = useState<ApplicationDashboardFilters>({ page: 1, pageSize: 20 });
  const [data, setData] = useState<ApplicationDashboardView>();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canWrite = Boolean(user?.permissions.includes(PermissionCode.APPLICATIONS_WRITE));
  const isButler = Boolean(
    user?.roles.includes(RoleCode.BUTLER) && !user.roles.includes(RoleCode.ADMINISTRATOR),
  );
  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);
  const visibleRisks = isButler
    ? (["PENDING_EVIDENCE", "OVERDUE", "DUE_7_DAYS"] as const)
    : RISK_ORDER;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getApplicationDashboard(filters));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "申请管理总览加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters, messageApi]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const studentId = params.get("studentId");
    const applicationId = params.get("applicationId");
    if (studentId) {
      router.replace(`/workspace/applications/students/${studentId}`);
      return;
    }
    if (applicationId) {
      void getApplication(applicationId)
        .then((application) =>
          router.replace(
            `/workspace/applications/students/${application.student.id}?applicationId=${application.id}`,
          ),
        )
        .catch((error: unknown) =>
          messageApi.error(error instanceof Error ? error.message : "申请记录加载失败"),
        );
    }
  }, [messageApi, router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!canWrite) return;
    void listStudents({ pageSize: 100, mine })
      .then((result) => setStudents(result.items))
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "学生列表加载失败"),
      );
  }, [canWrite, messageApi, mine]);

  const attentionHref = useMemo(
    () => `/workspace/applications/attention?${filterQuery(filters).toString()}`,
    [filters],
  );

  return (
    <PermissionPage permission={PermissionCode.APPLICATIONS_READ}>
      {contextHolder}
      <PageShell
        title={isButler ? "我的申请工作台" : "申请管理"}
        description={
          isButler
            ? "先处理即将截止或待补凭证的申请，再进入学生记录每次外部操作。"
            : "按风险优先监督申请进度，再进入学生查看每份申请的完整状态。"
        }
        extra={
          canWrite ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新增申请
            </Button>
          ) : null
        }
      >
        <Space orientation="vertical" size={20} style={{ width: "100%" }}>
          <ApplicationFiltersBar
            filters={filters}
            owners={data?.owners ?? []}
            onChange={setFilters}
          />
          {loading && !data ? (
            <div style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
              <Spin size="large" />
            </div>
          ) : data ? (
            <>
              <section aria-labelledby="deadline-risk-heading">
                <SectionHeading
                  id="deadline-risk-heading"
                  title={isButler ? "我的优先事项" : "截止与凭证风险"}
                  description={
                    isButler
                      ? "待补凭证、已逾期和 7 天内截止的申请优先展示。"
                      : "集中查看逾期、待补凭证、截止时间异常和临近截止申请。"
                  }
                />
                <Row gutter={[12, 12]}>
                  {visibleRisks.map((risk) => (
                    <Col xs={24} md={8} key={risk}>
                      <SummaryCard
                        title={RISK_META[risk].label}
                        metric={data.summary.risks[risk]}
                        active={filters.risk === risk}
                        color={RISK_META[risk].color}
                        background={RISK_META[risk].background}
                        border={RISK_META[risk].border}
                        onClick={() =>
                          setFilters((current) => ({
                            ...current,
                            risk: current.risk === risk ? undefined : risk,
                            page: 1,
                          }))
                        }
                      />
                    </Col>
                  ))}
                </Row>
              </section>

              {!isButler ? (
                <section aria-labelledby="application-stage-heading">
                  <SectionHeading
                    id="application-stage-heading"
                    title="申请阶段"
                    description="汇总展示业务阶段，单份申请仍保留精确状态。"
                  />
                  <Row gutter={[12, 12]}>
                    {STAGE_ORDER.map((stage) => (
                      <Col xs={12} md={8} xl={4} key={stage}>
                        <SummaryCard
                          compact
                          title={STAGE_META[stage].label}
                          metric={data.summary.stages[stage]}
                          active={filters.stage === stage}
                          color={stageColor(stage)}
                          onClick={() =>
                            setFilters((current) => ({
                              ...current,
                              stage: current.stage === stage ? undefined : stage,
                              page: 1,
                            }))
                          }
                        />
                      </Col>
                    ))}
                  </Row>
                </section>
              ) : null}

              <section aria-labelledby="attention-heading">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    marginBottom: 12,
                  }}
                >
                  <SectionHeading
                    id="attention-heading"
                    title={`${isButler ? "我的待处理申请" : "需关注申请"} · ${data.attention.total}`}
                    description={
                      isButler
                        ? "按风险和截止时间排序，首页先展示最紧急的 5 条。"
                        : "首页只展示当前优先级最高的 5 条。"
                    }
                    noMargin
                  />
                  {data.attention.total > 0 ? <Link href={attentionHref}>查看全部</Link> : null}
                </div>
                <AttentionTable
                  items={data.attention.items}
                  loading={loading}
                  onOpen={(studentId, applicationId) =>
                    router.push(
                      `/workspace/applications/students/${studentId}?applicationId=${applicationId}`,
                    )
                  }
                />
              </section>

              <section aria-labelledby="student-overview-heading">
                <SectionHeading
                  id="student-overview-heading"
                  title={`${isButler ? "我的学生" : "学生申请总览"} · ${data.students.total}`}
                  description={
                    isButler
                      ? "每名学生一行，进入后管理其申请并记录工作留痕。"
                      : "每名学生一行，按风险等级和最近截止时间排序。"
                  }
                />
                <StudentSummaryTable
                  items={data.students.items}
                  loading={loading}
                  page={data.students.page}
                  pageSize={data.students.pageSize}
                  total={data.students.total}
                  onPageChange={(page, pageSize) =>
                    setFilters((current) => ({ ...current, page, pageSize }))
                  }
                  onOpen={(studentId) =>
                    router.push(`/workspace/applications/students/${studentId}`)
                  }
                />
              </section>
            </>
          ) : null}
        </Space>
      </PageShell>
      <CreateApplicationModal
        open={createOpen}
        students={students}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
      />
    </PermissionPage>
  );
}

function SummaryCard({
  title,
  metric,
  active,
  color,
  background,
  border,
  compact = false,
  onClick,
}: {
  title: string;
  metric: ApplicationSummaryMetric;
  active: boolean;
  color: string;
  background?: string;
  border?: string;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{ width: "100%", padding: 0, border: 0, background: "transparent", textAlign: "left" }}
    >
      <Card
        hoverable
        size="small"
        style={{
          minHeight: compact ? 104 : 118,
          background: background ?? "#fff",
          borderColor: active ? (border ?? color) : undefined,
          boxShadow: active ? `0 0 0 2px ${border ?? color}33` : undefined,
        }}
      >
        <Statistic
          title={title}
          value={metric.applicationCount}
          suffix="份"
          styles={{ content: { color, fontSize: compact ? 26 : 30 } }}
        />
        <Typography.Text type="secondary">涉及 {metric.studentCount} 名学生</Typography.Text>
      </Card>
    </button>
  );
}

function SectionHeading({
  id,
  title,
  description,
  noMargin = false,
}: {
  id: string;
  title: string;
  description: string;
  noMargin?: boolean;
}) {
  return (
    <div style={{ marginBottom: noMargin ? 0 : 12 }}>
      <Typography.Title id={id} level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      <Typography.Text type="secondary">{description}</Typography.Text>
    </div>
  );
}

function AttentionTable({
  items,
  loading,
  onOpen,
}: {
  items: ApplicationDashboardView["attention"]["items"];
  loading: boolean;
  onOpen: (studentId: string, applicationId: string) => void;
}) {
  return (
    <Table
      rowKey="id"
      loading={loading}
      dataSource={items}
      pagination={false}
      locale={{ emptyText: <Empty description="当前没有需关注申请" /> }}
      scroll={{ x: 980 }}
      onRow={(record) => ({
        onClick: () => onOpen(record.student.id, record.id),
        style: { cursor: "pointer" },
      })}
      columns={[
        {
          title: "风险 / 行动",
          width: 170,
          render: (_value, item) => <AttentionBadge attention={item.attention} />,
        },
        {
          title: "学生",
          width: 140,
          render: (_value, item) => (
            <Space orientation="vertical" size={0}>
              <strong>{item.student.name}</strong>
              <Typography.Text type="secondary">{item.student.studentNo}</Typography.Text>
            </Space>
          ),
        },
        {
          title: "院校 / 专业",
          width: 260,
          render: (_value, item) => (
            <Space orientation="vertical" size={0}>
              <strong>{item.institutionName}</strong>
              <Typography.Text type="secondary">{item.programName ?? "未填写专业"}</Typography.Text>
            </Space>
          ),
        },
        {
          title: "精确状态",
          dataIndex: "status",
          width: 120,
          render: (status: string) => <ApplicationStatusTag status={status} />,
        },
        {
          title: "截止时间",
          width: 180,
          render: (_value, item) =>
            formatDateTime(item.attention.deadlineAt ?? item.effectiveDeadlineAt),
        },
        {
          title: "负责人",
          width: 120,
          render: (_value, item) => item.owner?.displayName ?? "未分配",
        },
      ]}
    />
  );
}

function StudentSummaryTable({
  items,
  loading,
  page,
  pageSize,
  total,
  onPageChange,
  onOpen,
}: {
  items: StudentApplicationSummaryView[];
  loading: boolean;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (studentId: string) => void;
}) {
  return (
    <Table<StudentApplicationSummaryView>
      rowKey={(item) => item.student.id}
      loading={loading}
      dataSource={items}
      pagination={{ current: page, pageSize, total, showSizeChanger: false }}
      locale={{ emptyText: <Empty description="暂无匹配学生" /> }}
      scroll={{ x: 1060 }}
      onChange={(pagination) => onPageChange(pagination.current ?? 1, pagination.pageSize ?? 20)}
      onRow={(record) => ({
        onClick: () => onOpen(record.student.id),
        style: { cursor: "pointer" },
      })}
      columns={[
        {
          title: "学生",
          width: 150,
          render: (_value, item) => (
            <Space orientation="vertical" size={0}>
              <strong>{item.student.name}</strong>
              <Typography.Text type="secondary">{item.student.studentNo}</Typography.Text>
            </Space>
          ),
        },
        {
          title: "申请概况",
          width: 150,
          render: (_value, item) => (
            <Space orientation="vertical" size={0}>
              <strong>{item.totalApplications} 份申请</strong>
              <Typography.Text type={item.attentionCount ? "danger" : "secondary"}>
                {item.attentionCount ? `${item.attentionCount} 份需关注` : "当前无异常"}
              </Typography.Text>
            </Space>
          ),
        },
        {
          title: "阶段分布",
          width: 260,
          render: (_value, item) => (
            <Space wrap size={[4, 4]}>
              {STAGE_ORDER.filter((stage) => item.stageCounts[stage] > 0).map((stage) => (
                <Tag color={STAGE_META[stage].color} key={stage}>
                  {STAGE_META[stage].label} {item.stageCounts[stage]}
                </Tag>
              ))}
            </Space>
          ),
        },
        {
          title: "最需关注申请",
          width: 270,
          render: (_value, item) => (
            <Space orientation="vertical" size={2}>
              <strong>{item.priorityApplication.institutionName}</strong>
              <Typography.Text type="secondary">
                {item.priorityApplication.programName ?? "未填写专业"}
              </Typography.Text>
              <ApplicationStatusTag status={item.priorityApplication.status} />
            </Space>
          ),
        },
        {
          title: "截止风险",
          width: 180,
          render: (_value, item) =>
            item.priorityApplication.attention ? (
              <AttentionBadge attention={item.priorityApplication.attention} />
            ) : (
              <Typography.Text type="secondary">
                {formatDateTime(item.priorityApplication.effectiveDeadlineAt)}
              </Typography.Text>
            ),
        },
        {
          title: "负责人",
          width: 130,
          render: (_value, item) =>
            item.owners.length
              ? item.owners.map((owner) => owner.displayName).join("、")
              : "未分配",
        },
      ]}
    />
  );
}

function filterQuery(filters: ApplicationDashboardFilters) {
  const query = new URLSearchParams();
  if (filters.search) query.set("search", filters.search);
  if (filters.ownerId) query.set("ownerId", filters.ownerId);
  if (filters.channel) query.set("channel", filters.channel);
  if (filters.stage) query.set("stage", filters.stage);
  if (filters.risk) query.set("risk", filters.risk);
  return query;
}

function stageColor(stage: ApplicationStageCode) {
  return (
    {
      PREPARING: "#0891b2",
      PENDING_SUBMISSION: "#1d4ed8",
      SUBMITTED: "#2563eb",
      ACTION_REQUIRED: "#7e22ce",
      ADMITTED: "#15803d",
      CLOSED: "#64748b",
    } satisfies Record<ApplicationStageCode, string>
  )[stage];
}
