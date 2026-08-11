"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
  Upload,
  message,
} from "antd";
import type { StudentRecord } from "../students/student-types";
import {
  addApplicationActivity,
  addApplicationEvidence,
  changeApplicationStatus,
  createApplication,
  createApplicationRequirement,
  invalidateApplicationActivity,
  returnApplicationEvidence,
  setApplicationMaterials,
  transferApplicationOwner,
  type ApplicationDashboardFilters,
} from "./operations-api";
import {
  RISK_META,
  STAGE_META,
  STAGE_ORDER,
  STATUS_META,
  attentionRelativeLabel,
  channelLabel,
  formatDateTime,
} from "./application-meta";
import type { APPLICATION_STATUSES } from "./application-meta";
import type {
  ApplicationAttentionView,
  ApplicationActivityType,
  ApplicationRiskCode,
  ApplicationView,
  PersonRef,
} from "./operations-types";

export function ApplicationStatusTag({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

export function AttentionBadge({ attention }: { attention: ApplicationAttentionView | null }) {
  if (!attention) return <Typography.Text type="secondary">暂无时间风险</Typography.Text>;
  if (attention.code === "ACTION_REQUIRED") {
    return (
      <Space orientation="vertical" size={0}>
        <Tag color="purple">需要跟进</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {attention.reason}
        </Typography.Text>
      </Space>
    );
  }
  const meta = RISK_META[attention.code];
  return (
    <Space orientation="vertical" size={2}>
      <Tag
        style={{
          color: meta.color,
          background: meta.background,
          borderColor: meta.border,
          fontWeight: 600,
        }}
      >
        {attentionRelativeLabel(attention)}
      </Tag>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {attention.reason}
      </Typography.Text>
    </Space>
  );
}

export function ApplicationFiltersBar({
  filters,
  owners,
  showRisk = false,
  onChange,
}: {
  filters: ApplicationDashboardFilters;
  owners: PersonRef[];
  showRisk?: boolean;
  onChange: (filters: ApplicationDashboardFilters) => void;
}) {
  const [search, setSearch] = useState(filters.search ?? "");

  useEffect(() => setSearch(filters.search ?? ""), [filters.search]);

  const update = (patch: Partial<ApplicationDashboardFilters>) =>
    onChange({ ...filters, ...patch, page: 1 });
  const hasFilters = Boolean(
    filters.search || filters.ownerId || filters.channel || filters.stage || filters.risk,
  );

  return (
    <Space wrap size={[10, 10]} style={{ width: "100%" }}>
      <Input.Search
        allowClear
        value={search}
        placeholder="搜索学生、院校、专业或申请编号"
        style={{ width: "min(100%, 360px)" }}
        onChange={(event) => {
          setSearch(event.target.value);
          if (!event.target.value && filters.search) update({ search: undefined });
        }}
        onSearch={(value) => update({ search: value.trim() || undefined })}
      />
      <Select
        allowClear
        placeholder="负责人"
        value={filters.ownerId}
        style={{ width: 150 }}
        options={owners.map((owner) => ({ value: owner.id, label: owner.displayName }))}
        onChange={(ownerId) => update({ ownerId })}
      />
      <Select
        allowClear
        placeholder="渠道"
        value={filters.channel}
        style={{ width: 130 }}
        options={[
          { value: "HK_DIRECT", label: "港校直申" },
          { value: "JUPAS", label: "JUPAS" },
        ]}
        onChange={(channel) => update({ channel })}
      />
      <Select
        allowClear
        placeholder="业务阶段"
        value={filters.stage}
        style={{ width: 140 }}
        options={STAGE_ORDER.map((stage) => ({ value: stage, label: STAGE_META[stage].label }))}
        onChange={(stage) => update({ stage })}
      />
      {showRisk ? (
        <Select
          allowClear
          placeholder="时间风险"
          value={filters.risk}
          style={{ width: 150 }}
          options={(Object.keys(RISK_META) as ApplicationRiskCode[]).map((risk) => ({
            value: risk,
            label: RISK_META[risk].label,
          }))}
          onChange={(risk) => update({ risk })}
        />
      ) : null}
      {hasFilters ? (
        <Button
          onClick={() => {
            setSearch("");
            onChange({ page: 1, pageSize: filters.pageSize });
          }}
        >
          清除筛选
        </Button>
      ) : null}
    </Space>
  );
}

export function ApplicationsTable({
  items,
  loading,
  onSelect,
}: {
  items: ApplicationView[];
  loading: boolean;
  onSelect: (application: ApplicationView) => void;
}) {
  return (
    <Table<ApplicationView>
      rowKey="id"
      loading={loading}
      dataSource={items}
      pagination={false}
      locale={{ emptyText: <Empty description="暂无申请记录" /> }}
      onRow={(record) => ({
        onClick: () => onSelect(record),
        style: { cursor: "pointer" },
      })}
      scroll={{ x: 960 }}
      columns={[
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
          title: "当前状态",
          dataIndex: "status",
          width: 120,
          render: (status: string) => <ApplicationStatusTag status={status} />,
        },
        {
          title: "关键截止",
          width: 210,
          render: (_value, item) => <ApplicationDeadline application={item} />,
        },
        {
          title: "渠道",
          dataIndex: "channel",
          width: 100,
          render: (channel: ApplicationView["channel"]) => channelLabel(channel),
        },
        {
          title: "负责人",
          dataIndex: "owner",
          width: 120,
          render: (owner: ApplicationView["owner"]) => owner?.displayName ?? "未分配",
        },
        {
          title: "待办",
          width: 80,
          render: (_value, item) =>
            item.requirements.filter((entry) => entry.status === "OPEN").length,
        },
      ]}
    />
  );
}

export function ApplicationDetailDrawer({
  application,
  canWrite,
  isAdministrator,
  ownerOptions,
  onClose,
  onRefresh,
}: {
  application: ApplicationView | null;
  canWrite: boolean;
  isAdministrator: boolean;
  ownerOptions: PersonRef[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [statusOpen, setStatusOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState<ApplicationActivityType>("OTHER");
  const [correctionOfActivityId, setCorrectionOfActivityId] = useState<string>();
  const [evidenceFile, setEvidenceFile] = useState<File>();
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [selectedMaterialVersions, setSelectedMaterialVersions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [statusForm] = Form.useForm();
  const [activityForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const eligibleMaterials = useMemo(
    () =>
      application?.availableMaterials.filter(
        (item) => item.currentVersion?.reviewStatus === "APPROVED",
      ) ?? [],
    [application],
  );
  const materialsFrozen = Boolean(
    application?.submittedAt ||
    application?.materialSnapshots.some((snapshot) => snapshot.frozenAt),
  );
  const canRecordSubmission = Boolean(
    application &&
    ["PLANNING", "CONFIRMED", "MATERIAL_PREPARATION", "PENDING_SUBMISSION"].includes(
      application.status,
    ),
  );
  const resultOptions = application ? applicationResultOptions(application.status) : [];
  const processStatusOptions = application
    ? applicationProcessStatusOptions(application.status)
    : [];

  useEffect(() => {
    setSelectedMaterialVersions(
      application?.materialSnapshots.map((snapshot) => snapshot.materialVersion.id) ?? [],
    );
  }, [application]);

  const openActivity = (type: ApplicationActivityType, correctionId?: string) => {
    setActivityType(type);
    setCorrectionOfActivityId(correctionId);
    setEvidenceFile(undefined);
    activityForm.resetFields();
    activityForm.setFieldsValue({
      activityType: type,
      occurredAt: toDateTimeLocal(new Date()),
      submittedAt: type === "SUBMISSION_RECORDED" ? toDateTimeLocal(new Date()) : undefined,
      studentVisible: false,
    });
    setActivityOpen(true);
  };

  const saveActivity = async () => {
    if (!application) return;
    const values = await activityForm.validateFields();
    if (values.activityType === "RESULT_RECORDED" && !evidenceFile) {
      messageApi.error("正式结果必须上传通知书、邮件截图或其他凭证");
      return;
    }
    setSubmitting(true);
    try {
      await addApplicationActivity(
        application.id,
        {
          ...values,
          activityType: values.activityType,
          occurredAt: values.occurredAt ? new Date(values.occurredAt).toISOString() : undefined,
          submittedAt: values.submittedAt ? new Date(values.submittedAt).toISOString() : undefined,
          confirmationDeadline: values.confirmationDeadline
            ? new Date(values.confirmationDeadline).toISOString()
            : undefined,
          correctionOfActivityId,
          version: application.version,
        },
        evidenceFile,
      );
      setActivityOpen(false);
      activityForm.resetFields();
      setEvidenceFile(undefined);
      await onRefresh();
      messageApi.success(
        values.activityType === "SUBMISSION_RECORDED" && !evidenceFile
          ? "已记录外部操作，当前标记为待补凭证"
          : "工作留痕已记录",
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "记录失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {contextHolder}
      <Drawer
        title={
          application
            ? `${application.institutionName} · ${application.programName ?? "申请详情"}`
            : "申请详情"
        }
        size="large"
        open={Boolean(application)}
        onClose={onClose}
        extra={
          canWrite && application ? (
            <Space wrap>
              <Button
                onClick={() => {
                  const description = window.prompt("请输入节点待办说明");
                  if (!description) return;
                  const dueAt = window.prompt("请输入截止时间（例如 2026-09-01T18:00:00+08:00）");
                  if (!dueAt) return;
                  void createApplicationRequirement(application.id, {
                    requirementType: "OTHER",
                    description,
                    dueAt: new Date(dueAt).toISOString(),
                    createTask: true,
                    isBlocking: true,
                  })
                    .then(onRefresh)
                    .catch((error: unknown) =>
                      messageApi.error(error instanceof Error ? error.message : "创建失败"),
                    );
                }}
              >
                新增截止待办
              </Button>
              <Button
                disabled={materialsFrozen}
                onClick={() => {
                  setSelectedMaterialVersions(
                    application.materialSnapshots.map((snapshot) => snapshot.materialVersion.id),
                  );
                  setMaterialsOpen(true);
                }}
              >
                {materialsFrozen ? "递交后不可改资料" : "选择申请资料"}
              </Button>
              <Button onClick={() => openActivity("OTHER")}>记录进展</Button>
              {canRecordSubmission ? (
                <Button type="primary" onClick={() => openActivity("SUBMISSION_RECORDED")}>
                  记录递交
                </Button>
              ) : null}
              {resultOptions.length ? (
                <Button onClick={() => openActivity("RESULT_RECORDED")}>更新结果</Button>
              ) : null}
              {isAdministrator ? (
                <Button
                  onClick={() => {
                    transferForm.setFieldsValue({ ownerId: application.owner?.id });
                    setTransferOpen(true);
                  }}
                >
                  转交负责人
                </Button>
              ) : null}
              {processStatusOptions.length ? (
                <Button
                  onClick={() => {
                    statusForm.resetFields();
                    setStatusOpen(true);
                  }}
                >
                  调整过程状态
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {application ? (
          <Space orientation="vertical" size={24} style={{ width: "100%" }}>
            <Descriptions
              column={1}
              bordered
              size="small"
              items={[
                {
                  key: "student",
                  label: "学生",
                  children: (
                    <Link href={`/workspace/students/${application.student.id}`}>
                      {application.student.name}
                    </Link>
                  ),
                },
                {
                  key: "status",
                  label: "当前状态",
                  children: <ApplicationStatusTag status={application.status} />,
                },
                {
                  key: "deadline",
                  label: "关键截止",
                  children: <ApplicationDeadline application={application} />,
                },
                {
                  key: "deadlineMode",
                  label: "截止方式",
                  children: deadlineModeLabel(application.deadlineMode),
                },
                { key: "channel", label: "渠道", children: channelLabel(application.channel) },
                {
                  key: "choices",
                  label: application.channel === "JUPAS" ? "志愿顺序" : "专业选择",
                  children: application.programChoices.length ? (
                    <Space wrap>
                      {application.programChoices.map((choice, index) => (
                        <Tag key={`${choice}-${index}`}>
                          {application.channel === "JUPAS" ? `${index + 1}. ` : ""}
                          {choice}
                        </Tag>
                      ))}
                    </Space>
                  ) : (
                    "—"
                  ),
                },
                {
                  key: "basis",
                  label: "创建依据",
                  children: application.requestBasis ?? "—",
                },
                {
                  key: "owner",
                  label: "负责人",
                  children: application.owner?.displayName ?? "未分配",
                },
                {
                  key: "no",
                  label: "申请编号",
                  children: application.applicationNo ?? "—",
                },
                {
                  key: "portal",
                  label: "申请入口",
                  children: application.portalUrl ? (
                    <a href={application.portalUrl} target="_blank" rel="noreferrer">
                      打开外部申请系统
                    </a>
                  ) : (
                    "—"
                  ),
                },
                { key: "result", label: "结果", children: application.result ?? "—" },
                {
                  key: "offer",
                  label: "录取条件",
                  children: application.offerCondition ?? "—",
                },
              ]}
            />
            <section>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <Typography.Title level={4} style={{ marginBottom: 0 }}>
                    本次申请所用资料
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    只引用资料管理中已审核通过的版本；记录递交后自动冻结版本快照。
                  </Typography.Text>
                </div>
                <Link href={`/workspace/materials?studentId=${application.student.id}`}>
                  前往资料管理
                </Link>
              </div>
              {application.materialSnapshots.length ? (
                <div style={{ marginTop: 12 }}>
                  {application.materialSnapshots.map((snapshot) => (
                    <div
                      key={snapshot.id}
                      style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}
                    >
                      <Space wrap>
                        <strong>{snapshot.materialItem.title}</strong>
                        <Tag>v{snapshot.materialVersion.versionNo}</Tag>
                        {snapshot.frozenAt ? <Tag color="blue">递交版本已冻结</Tag> : null}
                        <a
                          href={snapshot.materialVersion.downloadUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          查看 / 下载
                        </a>
                      </Space>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未选择申请资料" />
              )}
            </section>
            <section>
              <Typography.Title level={4}>节点待办</Typography.Title>
              {application.requirements.length ? (
                application.requirements.map((entry) => (
                  <div
                    key={entry.id}
                    style={{ padding: "10px 0", borderBottom: "1px solid #e2e8f0" }}
                  >
                    <Space wrap>
                      <Tag>{entry.status}</Tag>
                      <span>{entry.description}</span>
                      {entry.dueAt ? (
                        <Typography.Text type="secondary">
                          {formatDateTime(entry.dueAt)}
                        </Typography.Text>
                      ) : null}
                      {entry.linkedTask ? (
                        <Link href={`/workspace/tasks/${entry.linkedTask.id}`}>
                          {entry.linkedTask.title}
                        </Link>
                      ) : null}
                    </Space>
                  </div>
                ))
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点待办" />
              )}
            </section>
            <section>
              <Typography.Title level={4}>工作留痕</Typography.Title>
              <Typography.Paragraph type="secondary">
                操作记录只追加、不覆盖；如需修正，请新增更正记录。管理员可将明显错误标记为无效。
              </Typography.Paragraph>
              <Timeline
                items={application.activities.map((activity) => ({
                  color: activity.invalidatedAt ? "gray" : "blue",
                  content: (
                    <div style={{ opacity: activity.invalidatedAt ? 0.58 : 1 }}>
                      <Space wrap>
                        <Tag>{activityLabel(activity.activityType)}</Tag>
                        {activity.targetStatus ? (
                          <ApplicationStatusTag status={activity.targetStatus} />
                        ) : null}
                        {activity.studentVisible ? <Tag color="green">学生可见</Tag> : null}
                        {activity.invalidatedAt ? <Tag>已标记无效</Tag> : null}
                      </Space>
                      <div style={{ marginTop: 4 }}>{activity.note}</div>
                      {activity.result ? <div>结果：{activity.result}</div> : null}
                      {activity.applicationNo ? (
                        <div>申请编号：{activity.applicationNo}</div>
                      ) : null}
                      {activity.portalUrl ? (
                        <div>
                          <a href={activity.portalUrl} target="_blank" rel="noreferrer">
                            打开关联链接
                          </a>
                        </div>
                      ) : null}
                      {activity.evidence.length ? (
                        <Space wrap style={{ marginTop: 6 }}>
                          {activity.evidence.map((evidence) => (
                            <a
                              key={evidence.id}
                              href={evidence.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {evidence.fileName}（{formatFileSize(evidence.fileSize)}）
                            </a>
                          ))}
                        </Space>
                      ) : activity.activityType === "SUBMISSION_RECORDED" ? (
                        <div style={{ marginTop: 6 }}>
                          <Tag color="orange">待补递交凭证</Tag>
                        </div>
                      ) : null}
                      {activity.invalidReason ? (
                        <Typography.Text type="danger">
                          无效原因：{activity.invalidReason}
                        </Typography.Text>
                      ) : null}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {activity.operator.displayName} · {formatDateTime(activity.occurredAt)}
                      </Typography.Text>
                      {canWrite && !activity.invalidatedAt ? (
                        <Space wrap size="small" style={{ marginTop: 6, display: "flex" }}>
                          <Button
                            size="small"
                            onClick={() => openActivity("CORRECTION", activity.id)}
                          >
                            新增更正
                          </Button>
                          {activity.activityType === "SUBMISSION_RECORDED" ? (
                            <Upload
                              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                              showUploadList={false}
                              beforeUpload={(file) => {
                                void addApplicationEvidence(
                                  application.id,
                                  activity.id,
                                  application.version,
                                  file,
                                )
                                  .then(async () => {
                                    await onRefresh();
                                    messageApi.success("递交凭证已补充");
                                  })
                                  .catch((error: unknown) =>
                                    messageApi.error(
                                      error instanceof Error ? error.message : "凭证上传失败",
                                    ),
                                  );
                                return Upload.LIST_IGNORE;
                              }}
                            >
                              <Button size="small">补充凭证</Button>
                            </Upload>
                          ) : null}
                          {isAdministrator && activity.activityType === "SUBMISSION_RECORDED" ? (
                            <Button
                              size="small"
                              onClick={() => {
                                const reason = window.prompt("请输入退回补证原因");
                                if (!reason) return;
                                void returnApplicationEvidence(application.id, activity.id, {
                                  reason,
                                  version: application.version,
                                })
                                  .then(async () => {
                                    await onRefresh();
                                    messageApi.success("已退回管家补充凭证");
                                  })
                                  .catch((error: unknown) =>
                                    messageApi.error(
                                      error instanceof Error ? error.message : "退回失败",
                                    ),
                                  );
                              }}
                            >
                              退回补证
                            </Button>
                          ) : null}
                          {isAdministrator ? (
                            <Button
                              size="small"
                              danger
                              onClick={() => {
                                const reason = window.prompt("请输入标记无效的原因");
                                if (!reason) return;
                                void invalidateApplicationActivity(
                                  application.id,
                                  activity.id,
                                  reason,
                                )
                                  .then(async () => {
                                    await onRefresh();
                                    messageApi.success("该记录已标记无效");
                                  })
                                  .catch((error: unknown) =>
                                    messageApi.error(
                                      error instanceof Error ? error.message : "操作失败",
                                    ),
                                  );
                              }}
                            >
                              标记无效
                            </Button>
                          ) : null}
                        </Space>
                      ) : null}
                    </div>
                  ),
                }))}
              />
            </section>
          </Space>
        ) : null}
      </Drawer>
      <Modal
        title="记录申请工作留痕"
        open={activityOpen}
        okText="保存记录"
        confirmLoading={submitting}
        destroyOnHidden
        onCancel={() => setActivityOpen(false)}
        onOk={() => void saveActivity()}
      >
        <Form form={activityForm} layout="vertical">
          <Form.Item name="activityType" label="记录类型" rules={[{ required: true }]}>
            <Select
              disabled={["SUBMISSION_RECORDED", "RESULT_RECORDED", "CORRECTION"].includes(
                activityType,
              )}
              onChange={(value: ApplicationActivityType) => setActivityType(value)}
              options={[
                { value: "OTHER", label: "一般进展" },
                { value: "SUPPLEMENT_RECORDED", label: "补件操作" },
                { value: "NOTIFICATION_RECEIVED", label: "收到学校通知" },
                { value: "SUBMISSION_RECORDED", label: "正式递交" },
                { value: "RESULT_RECORDED", label: "正式结果" },
                { value: "CORRECTION", label: "更正原记录" },
              ]}
            />
          </Form.Item>
          <Form.Item name="note" label="本次做了什么" rules={[{ required: true, max: 2000 }]}>
            <Input.TextArea rows={4} placeholder="例如：已在学校申请系统完成资料填写并提交" />
          </Form.Item>
          <Form.Item name="occurredAt" label="实际操作时间">
            <Input type="datetime-local" />
          </Form.Item>
          {activityType === "SUBMISSION_RECORDED" ? (
            <>
              <Form.Item name="submittedAt" label="实际递交时间" rules={[{ required: true }]}>
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="applicationNo" label="申请编号（如有）">
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="portalUrl" label="成功页或申请系统链接（如有）">
                <Input type="url" placeholder="https://" />
              </Form.Item>
            </>
          ) : null}
          {activityType === "RESULT_RECORDED" ? (
            <>
              <Form.Item name="targetStatus" label="正式结果" rules={[{ required: true }]}>
                <Select options={resultOptions} />
              </Form.Item>
              <Form.Item name="result" label="结果摘要" rules={[{ required: true, max: 500 }]}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="offerCondition" label="录取条件（如适用）">
                <Input.TextArea rows={2} maxLength={1000} />
              </Form.Item>
              <Form.Item name="confirmationDeadline" label="录取确认截止时间（如适用）">
                <Input type="datetime-local" />
              </Form.Item>
              <Form.Item name="intakeDecision" label="入读决定说明（如适用）">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </>
          ) : null}
          <Form.Item name="studentVisible" valuePropName="checked">
            <Checkbox>同步一条简要动态给学生</Checkbox>
          </Form.Item>
          <Form.Item
            label={activityType === "RESULT_RECORDED" ? "结果凭证（必填）" : "操作凭证（可选）"}
          >
            <Upload
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              maxCount={1}
              beforeUpload={(file) => {
                setEvidenceFile(file);
                return false;
              }}
              onRemove={() => setEvidenceFile(undefined)}
            >
              <Button>选择文件</Button>
            </Upload>
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 4 }}>
              支持 PDF、Word、JPG、PNG，最大 50MB。递交时可稍后补证，正式结果必须上传。
            </Typography.Text>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="选择本次申请使用的资料"
        open={materialsOpen}
        okText="保存选择"
        onCancel={() => setMaterialsOpen(false)}
        onOk={() => {
          if (!application) return;
          setSubmitting(true);
          void setApplicationMaterials(
            application.id,
            selectedMaterialVersions,
            application.version,
          )
            .then(async () => {
              setMaterialsOpen(false);
              await onRefresh();
              messageApi.success("申请资料选择已保存");
            })
            .catch((error: unknown) =>
              messageApi.error(error instanceof Error ? error.message : "保存失败"),
            )
            .finally(() => setSubmitting(false));
        }}
        confirmLoading={submitting}
      >
        {eligibleMaterials.length ? (
          <Checkbox.Group
            value={selectedMaterialVersions}
            onChange={(values) => setSelectedMaterialVersions(values as string[])}
            style={{ width: "100%" }}
          >
            <Space orientation="vertical" style={{ width: "100%" }}>
              {eligibleMaterials.map((item) => (
                <Checkbox key={item.currentVersion!.id} value={item.currentVersion!.id}>
                  {item.title} · v{item.currentVersion!.versionNo}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        ) : (
          <Empty description="该学生暂无已审核通过的资料" />
        )}
      </Modal>
      <Modal
        title="转交申请负责人"
        open={transferOpen}
        okText="确认转交"
        confirmLoading={submitting}
        onCancel={() => setTransferOpen(false)}
        onOk={() => {
          if (!application) return;
          void transferForm.validateFields().then(async (values) => {
            setSubmitting(true);
            try {
              await transferApplicationOwner(application.id, {
                ...values,
                version: application.version,
              });
              setTransferOpen(false);
              transferForm.resetFields();
              await onRefresh();
              messageApi.success("申请负责人已转交");
            } catch (error) {
              messageApi.error(error instanceof Error ? error.message : "转交失败");
            } finally {
              setSubmitting(false);
            }
          });
        }}
      >
        <Form form={transferForm} layout="vertical">
          <Form.Item name="ownerId" label="新负责人" rules={[{ required: true }]}>
            <Select
              showSearch
              optionFilterProp="label"
              options={ownerOptions.map((owner) => ({
                value: owner.id,
                label: owner.displayName,
              }))}
            />
          </Form.Item>
          <Form.Item name="reason" label="转交原因" rules={[{ required: true, max: 1000 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="调整过程状态"
        open={statusOpen}
        okText="确认更新"
        onCancel={() => setStatusOpen(false)}
        onOk={() =>
          void statusForm
            .validateFields()
            .then(async (values) => {
              if (!application) return;
              await changeApplicationStatus(application.id, {
                ...values,
                submittedAt: values.submittedAt
                  ? new Date(values.submittedAt).toISOString()
                  : undefined,
                confirmationDeadline: values.confirmationDeadline
                  ? new Date(values.confirmationDeadline).toISOString()
                  : undefined,
                version: application.version,
              });
              setStatusOpen(false);
              statusForm.resetFields();
              await onRefresh();
              messageApi.success("申请状态已更新");
            })
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form form={statusForm} layout="vertical">
          <Form.Item name="status" label="新状态" rules={[{ required: true }]}>
            <Select
              options={processStatusOptions.map((status) => ({
                value: status,
                label: STATUS_META[status]?.label ?? status,
              }))}
            />
          </Form.Item>
          <Form.Item name="note" label="变更说明" rules={[{ required: true, max: 1000 }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function CreateApplicationModal({
  open,
  students,
  lockedStudentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  students: StudentRecord[];
  lockedStudentId?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  useEffect(() => {
    if (open && lockedStudentId) form.setFieldValue("studentId", lockedStudentId);
  }, [form, lockedStudentId, open]);

  return (
    <>
      {contextHolder}
      <Modal
        title="新增申请"
        open={open}
        okText="创建"
        onCancel={onClose}
        onOk={() =>
          void form
            .validateFields()
            .then(async (values) => {
              await createApplication({
                ...values,
                programChoices: String(values.programChoicesText ?? "")
                  .split(/\r?\n/)
                  .map((choice) => choice.trim())
                  .filter(Boolean),
                programChoicesText: undefined,
                deadlineAt: values.deadlineAt ? new Date(values.deadlineAt).toISOString() : null,
              });
              form.resetFields();
              onClose();
              await onCreated();
              messageApi.success("申请已创建");
            })
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ channel: "HK_DIRECT", deadlineMode: "UNKNOWN" }}
        >
          <Form.Item name="studentId" label="学生" rules={[{ required: true }]}>
            <Select
              disabled={Boolean(lockedStudentId)}
              showSearch
              optionFilterProp="label"
              options={students.map((student) => ({
                value: student.id,
                label: `${student.name} · ${student.studentNo}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="channel" label="渠道" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "HK_DIRECT", label: "港校直申" },
                { value: "JUPAS", label: "JUPAS" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="institutionName"
            label="院校 / 申请体系"
            rules={[{ required: true, max: 200 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="programChoicesText" label="专业 / 志愿（每行一个，可按顺序填写）">
            <Input.TextArea rows={3} maxLength={4000} />
          </Form.Item>
          <Form.Item name="deadlineMode" label="截止方式" rules={[{ required: true }]}>
            <Select
              options={[
                { value: "FIXED", label: "固定截止时间" },
                { value: "ROLLING", label: "滚动录取，无固定截止" },
                { value: "UNKNOWN", label: "暂未确认" },
              ]}
            />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(before, after) => before.deadlineMode !== after.deadlineMode}
          >
            {({ getFieldValue }) =>
              getFieldValue("deadlineMode") === "FIXED" ? (
                <Form.Item name="deadlineAt" label="申请截止时间" rules={[{ required: true }]}>
                  <Input type="datetime-local" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
          <Form.Item
            name="requestBasis"
            label="创建依据"
            rules={[{ required: true, max: 1000 }]}
            extra="记录学生已确认的目标或其他明确指令，不作为申请流程模板。"
          >
            <Input.TextArea rows={3} placeholder="例如：学生于 8 月 10 日确认申请该校" />
          </Form.Item>
          <Form.Item name="portalUrl" label="外部申请入口（如有）">
            <Input type="url" placeholder="https://" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function activityLabel(activityType: ApplicationActivityType) {
  return (
    {
      CREATED: "创建记录",
      MATERIALS_UPDATED: "选用资料",
      SUBMISSION_RECORDED: "正式递交",
      SUPPLEMENT_RECORDED: "补件操作",
      NOTIFICATION_RECEIVED: "学校通知",
      RESULT_RECORDED: "正式结果",
      CORRECTION: "更正记录",
      EVIDENCE_RETURNED: "退回补证",
      OWNER_TRANSFERRED: "负责人转交",
      OTHER: "一般进展",
    } satisfies Record<ApplicationActivityType, string>
  )[activityType];
}

function applicationProcessStatusOptions(
  status: string,
): Array<(typeof APPLICATION_STATUSES)[number]> {
  const transitions: Record<string, Array<(typeof APPLICATION_STATUSES)[number]>> = {
    PLANNING: ["CONFIRMED", "WITHDRAWN"],
    CONFIRMED: ["MATERIAL_PREPARATION", "PENDING_SUBMISSION", "WITHDRAWN"],
    MATERIAL_PREPARATION: ["PENDING_SUBMISSION", "WITHDRAWN"],
    PENDING_SUBMISSION: ["WITHDRAWN"],
    SUBMISSION_PENDING_EVIDENCE: ["WITHDRAWN"],
    SUBMITTED: ["WAITING_RESULT", "SUPPLEMENT", "INTERVIEW", "WITHDRAWN"],
    WAITING_RESULT: ["SUPPLEMENT", "INTERVIEW", "WITHDRAWN"],
    SUPPLEMENT: ["WAITING_RESULT", "INTERVIEW", "WITHDRAWN"],
    INTERVIEW: ["WAITING_RESULT", "WITHDRAWN"],
    WAITLISTED: ["WITHDRAWN"],
    OFFER: ["WITHDRAWN"],
  };
  return transitions[status] ?? [];
}

function applicationResultOptions(status: string) {
  if (["SUBMITTED", "WAITING_RESULT", "SUPPLEMENT", "INTERVIEW"].includes(status)) {
    return [
      { value: "WAITLISTED", label: "候补" },
      { value: "OFFER", label: "录取" },
      { value: "REJECTED", label: "拒绝" },
    ];
  }
  if (status === "WAITLISTED") {
    return [
      { value: "OFFER", label: "录取" },
      { value: "REJECTED", label: "拒绝" },
    ];
  }
  if (status === "OFFER") return [{ value: "ENROLLED", label: "确认入读" }];
  return [];
}

function deadlineModeLabel(mode: ApplicationView["deadlineMode"]) {
  if (mode === "FIXED") return "固定截止时间";
  if (mode === "ROLLING") return "滚动录取，无固定截止";
  return "暂未确认";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function toDateTimeLocal(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function ApplicationDeadline({ application }: { application: ApplicationView }) {
  const deadline = effectiveDeadline(application);
  const missing = missingDeadline(application);
  if (!deadline) {
    if (application.deadlineMode === "ROLLING") {
      return <Typography.Text type="secondary">滚动录取，无固定截止</Typography.Text>;
    }
    return missing ? (
      <Typography.Text style={{ color: RISK_META.MISSING_DEADLINE.color, fontWeight: 600 }}>
        待补充截止时间
      </Typography.Text>
    ) : (
      <Typography.Text type="secondary">—</Typography.Text>
    );
  }
  const days = daysUntil(deadline);
  const risk = days < 0 ? "OVERDUE" : days <= 7 ? "DUE_7_DAYS" : days <= 14 ? "DUE_14_DAYS" : null;
  return (
    <Space orientation="vertical" size={0}>
      <Typography.Text style={risk ? { color: RISK_META[risk].color, fontWeight: 600 } : undefined}>
        {formatDateTime(deadline)}
      </Typography.Text>
      {risk ? (
        <Typography.Text style={{ color: RISK_META[risk].color, fontSize: 12 }}>
          {days < 0 ? `已逾期 ${Math.abs(days)} 天` : days === 0 ? "今天截止" : `剩余 ${days} 天`}
        </Typography.Text>
      ) : null}
    </Space>
  );
}

function effectiveDeadline(application: ApplicationView) {
  const requirementDeadline = application.requirements
    .filter((requirement) => requirement.status === "OPEN" && requirement.dueAt)
    .map((requirement) => requirement.dueAt as string)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];
  if (application.status === "OFFER") {
    return application.confirmationDeadline ?? requirementDeadline ?? application.deadlineAt;
  }
  if (["SUPPLEMENT", "INTERVIEW"].includes(application.status)) {
    return requirementDeadline ?? null;
  }
  return application.deadlineAt ?? requirementDeadline ?? application.confirmationDeadline;
}

function missingDeadline(application: ApplicationView) {
  if (application.status === "PENDING_SUBMISSION") {
    return application.deadlineMode === "UNKNOWN";
  }
  if (application.status === "OFFER") return !application.confirmationDeadline;
  if (["SUPPLEMENT", "INTERVIEW"].includes(application.status)) {
    return !application.requirements.some(
      (requirement) =>
        requirement.status === "OPEN" &&
        requirement.requirementType === application.status &&
        Boolean(requirement.dueAt),
    );
  }
  return false;
}

function daysUntil(value: string) {
  const difference = new Date(value).getTime() - Date.now();
  const day = 24 * 60 * 60 * 1000;
  return difference >= 0 ? Math.ceil(difference / day) : -Math.ceil(Math.abs(difference) / day);
}
