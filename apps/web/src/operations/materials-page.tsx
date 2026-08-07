"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftOutlined,
  CloudUploadOutlined,
  EyeOutlined,
  FileAddOutlined,
  FileSearchOutlined,
  SearchOutlined,
  SyncOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { PermissionCode, RoleCode } from "@dse/shared";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { FilePreviewModal, type PreviewFile } from "../files/file-preview-modal";
import { PageShell } from "../layout/page-shell";
import { listStudents } from "../students/student-api";
import type { StudentRecord } from "../students/student-types";
import {
  addMaterialSubmissionFile,
  cancelSpecialMaterial,
  createMaterial,
  createMaterialSubmission,
  getMaterials,
  getMaterialTypes,
  removeMaterialSubmissionFile,
  reviewMaterial,
  reviewMaterialApplicability,
  reviewMaterialSubmission,
  runMaterialAutomationScan,
  startMaterialSubmissionReview,
  submitMaterialSubmission,
} from "./operations-api";
import type {
  MaterialItemView,
  MaterialSubmissionFileView,
  MaterialSubmissionView,
} from "./operations-types";
import styles from "./materials-page.module.css";

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  REQUIRED: { text: "待提交", color: "default" },
  DRAFT: { text: "草稿中", color: "cyan" },
  PENDING_REVIEW: { text: "待审核", color: "processing" },
  IN_REVIEW: { text: "审核中", color: "blue" },
  APPROVED: { text: "已通过", color: "success" },
  NEEDS_CORRECTION: { text: "待补正", color: "error" },
  PARTIALLY_MISSING: { text: "部分缺失", color: "warning" },
  RESUBMISSION_REQUIRED: { text: "需重交", color: "error" },
  AWAITING_CONFIRMATION: { text: "待确认", color: "gold" },
  NOT_APPLICABLE: { text: "不适用", color: "default" },
  CANCELED: { text: "已取消", color: "default" },
  WITHDRAWN: { text: "已撤回", color: "default" },
};

type Summary = {
  total: number;
  approved: number;
  pendingReview: number;
  missing: number;
  missingCore: number;
};

function statusTag(status: string) {
  const meta = STATUS_LABELS[status] ?? { text: status, color: "default" };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "—";
}

function formatSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function MaterialsPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentId, setStudentId] = useState<string>();
  const [studentSearch, setStudentSearch] = useState("");
  const [items, setItems] = useState<MaterialItemView[]>([]);
  const [summary, setSummary] = useState<Summary>({
    total: 0,
    approved: 0,
    pendingReview: 0,
    missing: 0,
    missingCore: 0,
  });
  const [types, setTypes] = useState<Array<{ id: string; name: string; isCore: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialItemView | null>(null);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [proxyItem, setProxyItem] = useState<MaterialItemView | null>(null);
  const [proxyReason, setProxyReason] = useState("");
  const [proxySubmission, setProxySubmission] = useState<MaterialSubmissionView | null>(null);
  const [proxyWorking, setProxyWorking] = useState(false);
  const [reviewSubmission, setReviewSubmission] = useState<MaterialSubmissionView | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<
    Record<string, { outcome: "APPROVED" | "CORRECTION_REQUIRED"; comment?: string }>
  >({});
  const [reviewComment, setReviewComment] = useState("");
  const [correctionDueAt, setCorrectionDueAt] = useState<string | null>(null);
  const [reviewWorking, setReviewWorking] = useState(false);
  const [automationRunning, setAutomationRunning] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();

  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);
  const isButler = Boolean(user?.roles.includes(RoleCode.BUTLER));
  const canProxyUpload =
    isButler && Boolean(user?.permissions.includes(PermissionCode.MATERIALS_WRITE));
  const canReview = Boolean(user?.permissions.includes(PermissionCode.MATERIALS_REVIEW));
  const isAdministrator = Boolean(user?.roles.includes(RoleCode.ADMINISTRATOR));
  const selectedStudent = students.find((student) => student.id === studentId);

  const runAutomation = async () => {
    setAutomationRunning(true);
    try {
      const result = await runMaterialAutomationScan();
      const created = result.dueSoonNotified + result.overdueNotified + result.reviewSlaNotified;
      if (result.failed > 0) {
        messageApi.warning(`扫描完成，新增 ${created} 条提醒，${result.failed} 条写入失败`);
      } else {
        messageApi.success(`扫描完成，新增 ${created} 条提醒；重复提醒已自动跳过`);
      }
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "提醒扫描失败");
    } finally {
      setAutomationRunning(false);
    }
  };

  const refresh = useCallback(
    async (selectedStudentId: string) => {
      setLoading(true);
      try {
        const result = await getMaterials(selectedStudentId);
        setItems(result.items);
        setSummary(result.summary);
        setSelectedMaterial((current) =>
          current ? (result.items.find((item) => item.id === current.id) ?? null) : null,
        );
      } catch (error) {
        messageApi.error(error instanceof Error ? error.message : "资料加载失败");
      } finally {
        setLoading(false);
      }
    },
    [messageApi],
  );

  useEffect(() => {
    void Promise.all([listStudents({ pageSize: 100, mine }), getMaterialTypes()])
      .then(([studentPage, materialTypes]) => {
        setStudents(studentPage.items);
        setTypes(materialTypes);
        const requestedId = new URLSearchParams(window.location.search).get("studentId");
        if (requestedId && studentPage.items.some((student) => student.id === requestedId)) {
          setStudentId(requestedId);
          void refresh(requestedId);
        }
      })
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "初始化失败"),
      )
      .finally(() => setInitializing(false));
  }, [messageApi, mine, refresh]);

  const visibleStudents = useMemo(() => {
    const keyword = studentSearch.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return students;
    return students.filter((student) =>
      [student.name, student.englishName, student.studentNo, student.school, student.grade]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("zh-CN").includes(keyword)),
    );
  }, [studentSearch, students]);

  const selectStudent = (nextStudentId?: string) => {
    setStudentId(nextStudentId);
    setItems([]);
    setSelectedMaterial(null);
    const url = new URL(window.location.href);
    if (nextStudentId) {
      url.searchParams.set("studentId", nextStudentId);
      void refresh(nextStudentId);
    } else {
      url.searchParams.delete("studentId");
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  };

  const openReview = async (submission: MaterialSubmissionView) => {
    setReviewWorking(true);
    try {
      const active =
        submission.status === "PENDING_REVIEW"
          ? await startMaterialSubmissionReview(submission.id)
          : submission;
      setReviewSubmission(active);
      setReviewDecisions({});
      setReviewComment(active.reviewComment ?? "");
      setCorrectionDueAt(null);
      if (studentId) await refresh(studentId);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "无法开始审核");
    } finally {
      setReviewWorking(false);
    }
  };

  const submitReview = async () => {
    if (!reviewSubmission || !studentId) return;
    const pendingFiles = reviewSubmission.files.filter((file) => file.reviewStatus === "PENDING");
    if (pendingFiles.some((file) => !reviewDecisions[file.id])) {
      messageApi.warning("请先逐一标记本次待审核文件");
      return;
    }
    const needsCorrection = pendingFiles.some(
      (file) => reviewDecisions[file.id]?.outcome === "CORRECTION_REQUIRED",
    );
    if (
      needsCorrection &&
      (!reviewComment.trim() ||
        !correctionDueAt ||
        pendingFiles.some(
          (file) =>
            reviewDecisions[file.id]?.outcome === "CORRECTION_REQUIRED" &&
            !reviewDecisions[file.id]?.comment?.trim(),
        ))
    ) {
      messageApi.warning("补正时需填写总体意见、截止时间和每个问题文件的原因");
      return;
    }
    setReviewWorking(true);
    try {
      await reviewMaterialSubmission(reviewSubmission.id, {
        outcome: needsCorrection ? "NEEDS_CORRECTION" : "APPROVED",
        comment: reviewComment.trim() || undefined,
        correctionDueAt: needsCorrection ? correctionDueAt! : undefined,
        fileDecisions: pendingFiles.map((file) => ({
          fileId: file.id,
          outcome: reviewDecisions[file.id]!.outcome,
          comment: reviewDecisions[file.id]!.comment?.trim() || undefined,
        })),
      });
      setReviewSubmission(null);
      await refresh(studentId);
      messageApi.success(needsCorrection ? "已退回补正" : "提交批次已审核通过");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "审核失败");
    } finally {
      setReviewWorking(false);
    }
  };

  const pendingReviewFiles =
    reviewSubmission?.files.filter((file) => file.reviewStatus === "PENDING") ?? [];

  const renderFile = (file: MaterialSubmissionFileView) => (
    <List.Item
      key={file.id}
      actions={[
        <Button key="view" size="small" icon={<EyeOutlined />} onClick={() => setPreviewFile(file)}>
          查看
        </Button>,
        <Button key="download" size="small" href={file.downloadUrl}>
          下载
        </Button>,
      ]}
    >
      <List.Item.Meta
        avatar={<FileSearchOutlined className={styles.fileIcon} />}
        title={
          <Space wrap>
            <span>{file.fileName}</span>
            {statusTag(file.reviewStatus)}
          </Space>
        }
        description={
          <Space orientation="vertical" size={0}>
            <span>
              {formatSize(file.fileSize)} · {formatDate(file.uploadedAt)}
            </span>
            {file.reviewComment ? <span>审核意见：{file.reviewComment}</span> : null}
          </Space>
        }
      />
    </List.Item>
  );

  return (
    <PermissionPage permission={PermissionCode.MATERIALS_READ}>
      {contextHolder}
      <PageShell
        title={selectedStudent ? `${selectedStudent.name}的资料` : "资料管理"}
        description={
          selectedStudent
            ? `${selectedStudent.studentNo} · 查看完整资料状态、提交批次和原始文件。`
            : "选择学生进入资料工作台；管理员负责监督审核，管家负责督促与少量特殊代传。"
        }
        extra={
          selectedStudent || (isAdministrator && canReview) ? (
            <Space wrap>
              {isAdministrator && canReview ? (
                <Button
                  icon={<SyncOutlined spin={automationRunning} />}
                  loading={automationRunning}
                  title="立即执行一次资料临期、逾期与审核超时扫描"
                  onClick={() => void runAutomation()}
                >
                  运行提醒扫描
                </Button>
              ) : null}
              {selectedStudent ? (
                <Button icon={<ArrowLeftOutlined />} onClick={() => selectStudent()}>
                  返回学生列表
                </Button>
              ) : null}
              {selectedStudent && canProxyUpload ? (
                <Button
                  type="primary"
                  icon={<FileAddOutlined />}
                  onClick={() => setCreateOpen(true)}
                >
                  新增特殊资料
                </Button>
              ) : null}
            </Space>
          ) : null
        }
      >
        {!studentId ? (
          <Space orientation="vertical" size={20} style={{ width: "100%" }}>
            <div className={styles.selectorHeader}>
              <div>
                <Typography.Title level={3}>选择学生</Typography.Title>
                <Typography.Text type="secondary">
                  共 {students.length} 名可访问学生，点击卡片进入资料详情。
                </Typography.Text>
              </div>
              <Input
                allowClear
                value={studentSearch}
                prefix={<SearchOutlined />}
                placeholder="搜索姓名、学号、学校或年级"
                className={styles.studentSearch}
                onChange={(event) => setStudentSearch(event.target.value)}
              />
            </div>
            {initializing ? (
              <Row gutter={[16, 16]}>
                {[1, 2, 3, 4].map((key) => (
                  <Col xs={24} md={12} xl={8} key={key}>
                    <Card loading />
                  </Col>
                ))}
              </Row>
            ) : visibleStudents.length ? (
              <Row gutter={[16, 16]}>
                {visibleStudents.map((student) => (
                  <Col xs={24} md={12} xl={8} key={student.id}>
                    <button
                      type="button"
                      className={styles.studentCard}
                      onClick={() => selectStudent(student.id)}
                    >
                      <span className={styles.studentAvatar}>{student.name.slice(0, 1)}</span>
                      <span className={styles.studentCardBody}>
                        <span className={styles.studentNameRow}>
                          <strong>{student.name}</strong>
                          <Tag color={student.serviceStatus === "ENABLED" ? "green" : "default"}>
                            {student.serviceStatus === "ENABLED" ? "服务中" : "未启用"}
                          </Tag>
                        </span>
                        <span className={styles.studentNumber}>{student.studentNo}</span>
                        <span className={styles.studentMeta}>
                          {student.school || "学校待补充"} · {student.grade || "年级待补充"}
                        </span>
                        <span className={styles.studentMeta}>
                          <UserOutlined /> 管家：{student.defaultButler?.displayName ?? "待分配"}
                        </span>
                        <span className={styles.enterHint}>进入资料工作台 →</span>
                      </span>
                    </button>
                  </Col>
                ))}
              </Row>
            ) : (
              <Empty description={students.length ? "没有匹配的学生" : "当前没有可管理的学生"} />
            )}
          </Space>
        ) : (
          <Space orientation="vertical" size={18} style={{ width: "100%" }}>
            <Row gutter={[12, 12]}>
              {[
                ["资料项", summary.total, "#1677ff"],
                ["已通过", summary.approved, "#16a34a"],
                ["待审核", summary.pendingReview, "#2563eb"],
                ["核心缺口", summary.missingCore, "#dc2626"],
              ].map(([title, value, color]) => (
                <Col xs={12} md={6} key={String(title)}>
                  <Card size="small" className={styles.statCard}>
                    <Statistic
                      title={title}
                      value={value}
                      styles={{ content: { color: String(color) } }}
                    />
                  </Card>
                </Col>
              ))}
            </Row>
            <Card className={styles.materialTableCard} styles={{ body: { padding: 0 } }}>
              <Table<MaterialItemView>
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无资料项" /> }}
                scroll={{ x: 980 }}
                columns={[
                  {
                    title: "资料",
                    dataIndex: "title",
                    render: (_value, item) => (
                      <Space orientation="vertical" size={2}>
                        <Space wrap>
                          <strong>{item.title}</strong>
                          {item.origin === "SPECIAL" ? <Tag color="purple">特殊资料</Tag> : null}
                          {item.requirementKind === "OPTIONAL" ? <Tag>选交</Tag> : null}
                        </Space>
                        <span className={styles.muted}>
                          {item.sopMaterialTemplate?.stageTemplate.name ?? item.materialType.name}
                        </span>
                      </Space>
                    ),
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 120,
                    render: (value: string) => statusTag(value),
                  },
                  {
                    title: "当前提交",
                    width: 230,
                    render: (_value, item) => {
                      const submission = item.currentSubmission;
                      if (submission) {
                        return (
                          <Space orientation="vertical" size={2}>
                            <span>
                              第 {submission.submissionNo} 批 · {submission.files.length} 个文件
                            </span>
                            <span className={styles.muted}>
                              {formatDate(submission.submittedAt)}
                            </span>
                          </Space>
                        );
                      }
                      return item.currentVersion
                        ? `旧版 v${item.currentVersion.versionNo} · ${item.currentVersion.fileName}`
                        : "尚未上传";
                    },
                  },
                  {
                    title: "截止时间",
                    dataIndex: "dueAt",
                    width: 170,
                    render: (value: string | null) => formatDate(value),
                  },
                  {
                    title: "操作",
                    fixed: "right",
                    width: 270,
                    render: (_value, item) => (
                      <Space wrap>
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => setSelectedMaterial(item)}
                        >
                          查看
                        </Button>
                        {canReview &&
                        item.currentSubmission &&
                        ["PENDING_REVIEW", "IN_REVIEW"].includes(item.currentSubmission.status) ? (
                          <Button
                            size="small"
                            type="primary"
                            loading={reviewWorking}
                            onClick={() => void openReview(item.currentSubmission!)}
                          >
                            {item.currentSubmission.status === "PENDING_REVIEW"
                              ? "开始审核"
                              : "继续审核"}
                          </Button>
                        ) : null}
                        {canReview &&
                        !item.currentSubmission &&
                        item.status === "PENDING_REVIEW" ? (
                          <Button
                            size="small"
                            type="primary"
                            onClick={() =>
                              void reviewMaterial(item.id, {
                                outcome: "APPROVED",
                                version: item.version,
                              })
                                .then(() => refresh(item.studentId))
                                .then(() => messageApi.success("旧版资料已通过"))
                                .catch((error: unknown) =>
                                  messageApi.error(
                                    error instanceof Error ? error.message : "审核失败",
                                  ),
                                )
                            }
                          >
                            通过旧版
                          </Button>
                        ) : null}
                        {canProxyUpload &&
                        ![
                          "APPROVED",
                          "NOT_APPLICABLE",
                          "CANCELED",
                          "PENDING_REVIEW",
                          "IN_REVIEW",
                          "DRAFT",
                        ].includes(item.status) ? (
                          <Button
                            size="small"
                            icon={<CloudUploadOutlined />}
                            onClick={() => {
                              setProxyItem(item);
                              setProxyReason("");
                              setProxySubmission(null);
                            }}
                          >
                            代学生上传
                          </Button>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Space>
        )}
      </PageShell>

      <Drawer
        title={selectedMaterial?.title ?? "资料详情"}
        size={760}
        open={Boolean(selectedMaterial)}
        onClose={() => setSelectedMaterial(null)}
      >
        {selectedMaterial ? (
          <Space orientation="vertical" size={18} style={{ width: "100%" }}>
            <Descriptions column={2} size="small" bordered>
              <Descriptions.Item label="状态">
                {statusTag(selectedMaterial.status)}
              </Descriptions.Item>
              <Descriptions.Item label="类型">
                {selectedMaterial.origin === "SPECIAL" ? "特殊资料" : "SOP 标准资料"}
              </Descriptions.Item>
              <Descriptions.Item label="阶段">
                {selectedMaterial.sopMaterialTemplate?.stageTemplate.name ?? "未归属阶段"}
              </Descriptions.Item>
              <Descriptions.Item label="截止时间">
                {formatDate(selectedMaterial.dueAt)}
              </Descriptions.Item>
              <Descriptions.Item label="提交要求" span={2}>
                {selectedMaterial.requirement ?? "暂无补充说明"}
              </Descriptions.Item>
              {selectedMaterial.creationReason ? (
                <Descriptions.Item label="特殊新增原因" span={2}>
                  {selectedMaterial.creationReason}
                </Descriptions.Item>
              ) : null}
            </Descriptions>

            {selectedMaterial.missingReason ? (
              <Alert
                type="warning"
                showIcon
                title="当前需要补充"
                description={`${selectedMaterial.missingReason}${selectedMaterial.correctionDueAt ? `；补正截止：${formatDate(selectedMaterial.correctionDueAt)}` : ""}`}
              />
            ) : null}

            {(selectedMaterial.applicabilityRequests ?? [])
              .filter((request) => request.status === "PENDING")
              .map((request) => (
                <Alert
                  key={request.id}
                  type="info"
                  showIcon
                  title="学生申请将此资料标记为不适用"
                  description={`${request.reason} · ${formatDate(request.createdAt)}`}
                  action={
                    canReview ? (
                      <Space>
                        <Button
                          size="small"
                          type="primary"
                          onClick={() =>
                            void reviewMaterialApplicability(request.id, { outcome: "APPROVED" })
                              .then(() => (studentId ? refresh(studentId) : undefined))
                              .then(() => messageApi.success("不适用申请已通过"))
                          }
                        >
                          通过
                        </Button>
                        <Button
                          size="small"
                          onClick={() => {
                            let comment = "";
                            Modal.confirm({
                              title: "驳回不适用申请",
                              content: (
                                <Input.TextArea
                                  style={{ marginTop: 12 }}
                                  placeholder="说明仍需提交的原因"
                                  onChange={(event) => (comment = event.target.value)}
                                />
                              ),
                              onOk: async () => {
                                if (!comment.trim()) throw new Error("请填写驳回原因");
                                await reviewMaterialApplicability(request.id, {
                                  outcome: "REJECTED",
                                  comment: comment.trim(),
                                });
                                if (studentId) await refresh(studentId);
                              },
                            });
                          }}
                        >
                          驳回
                        </Button>
                      </Space>
                    ) : null
                  }
                />
              ))}

            <section>
              <Typography.Title level={4}>当前提交批次</Typography.Title>
              {selectedMaterial.currentSubmission ? (
                <Card size="small">
                  <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                    <Space wrap>
                      <strong>第 {selectedMaterial.currentSubmission.submissionNo} 批</strong>
                      {statusTag(selectedMaterial.currentSubmission.status)}
                      <span className={styles.muted}>
                        {formatDate(selectedMaterial.currentSubmission.submittedAt)}
                      </span>
                    </Space>
                    {selectedMaterial.currentSubmission.reviewComment ? (
                      <Alert
                        type={
                          selectedMaterial.currentSubmission.status === "NEEDS_CORRECTION"
                            ? "warning"
                            : "info"
                        }
                        title="审核意见"
                        description={selectedMaterial.currentSubmission.reviewComment}
                      />
                    ) : null}
                    <List
                      size="small"
                      dataSource={selectedMaterial.currentSubmission.files}
                      renderItem={renderFile}
                    />
                  </Space>
                </Card>
              ) : selectedMaterial.currentVersion ? (
                <List
                  bordered
                  dataSource={[selectedMaterial.currentVersion]}
                  renderItem={(file) =>
                    renderFile({
                      ...file,
                      submissionId: undefined,
                      mimeType: file.mimeType ?? "application/octet-stream",
                      fileSize: file.fileSize ?? 0,
                      copiedFromFileId: null,
                    })
                  }
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未提交文件" />
              )}
            </section>

            {(selectedMaterial.submissions?.length ?? 0) > 1 ? (
              <section>
                <Typography.Title level={4}>历史提交</Typography.Title>
                <List
                  size="small"
                  dataSource={selectedMaterial.submissions.filter(
                    (submission) => submission.id !== selectedMaterial.currentSubmission?.id,
                  )}
                  renderItem={(submission) => (
                    <List.Item>
                      <List.Item.Meta
                        title={
                          <Space>
                            <span>第 {submission.submissionNo} 批</span>
                            {statusTag(submission.status)}
                          </Space>
                        }
                        description={`${submission.files.length} 个文件 · ${formatDate(submission.submittedAt ?? submission.withdrawnAt)}`}
                      />
                      <Button
                        size="small"
                        onClick={() => {
                          const first = submission.files[0];
                          if (first) setPreviewFile(first);
                        }}
                      >
                        查看文件
                      </Button>
                    </List.Item>
                  )}
                />
              </section>
            ) : null}

            {canReview &&
            selectedMaterial.origin === "SPECIAL" &&
            !["CANCELED", "PENDING_REVIEW", "IN_REVIEW", "DRAFT"].includes(
              selectedMaterial.status,
            ) ? (
              <Button
                danger
                onClick={() => {
                  let reason = "";
                  Modal.confirm({
                    title: "取消特殊资料项",
                    content: (
                      <Input.TextArea
                        style={{ marginTop: 12 }}
                        placeholder="填写取消原因，历史记录仍会保留"
                        onChange={(event) => (reason = event.target.value)}
                      />
                    ),
                    okButtonProps: { danger: true },
                    okText: "确认取消",
                    onOk: async () => {
                      if (!reason.trim()) throw new Error("请填写取消原因");
                      await cancelSpecialMaterial(
                        selectedMaterial.id,
                        selectedMaterial.version,
                        reason.trim(),
                      );
                      if (studentId) await refresh(studentId);
                      setSelectedMaterial(null);
                    },
                  });
                }}
              >
                取消特殊资料项
              </Button>
            ) : null}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="新增特殊资料"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void form
            .validateFields()
            .then(
              async (values: {
                materialTypeId: string;
                title: string;
                requirement?: string;
                requirementKind: "REQUIRED" | "OPTIONAL";
                dueAt?: { toISOString(): string };
                creationReason: string;
              }) => {
                if (!studentId) return;
                await createMaterial(studentId, {
                  ...values,
                  dueAt: values.dueAt?.toISOString() ?? null,
                });
                setCreateOpen(false);
                form.resetFields();
                await refresh(studentId);
                messageApi.success("特殊资料项已创建");
              },
            )
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Alert
          type="info"
          showIcon
          title="仅用于SOP清单外的少量特殊资料"
          description="标准资料应在SOP版本中配置，不在这里重复新增。"
          style={{ marginBottom: 16 }}
        />
        <Form form={form} layout="vertical" initialValues={{ requirementKind: "REQUIRED" }}>
          <Form.Item name="materialTypeId" label="资料类型" rules={[{ required: true }]}>
            <Select
              options={types.map((type) => ({
                value: type.id,
                label: `${type.name}${type.isCore ? "（核心）" : ""}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="标题" rules={[{ required: true, max: 150 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="requirementKind" label="要求类型" rules={[{ required: true }]}>
            <Radio.Group
              options={[
                { label: "必交", value: "REQUIRED" },
                { label: "选交", value: "OPTIONAL" },
              ]}
            />
          </Form.Item>
          <Form.Item name="dueAt" label="截止时间">
            <DatePicker showTime style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="requirement" label="提交要求">
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
          <Form.Item
            name="creationReason"
            label="特殊新增原因"
            rules={[{ required: true, max: 1000 }]}
          >
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={proxyItem ? `代学生上传 · ${proxyItem.title}` : "代学生上传"}
        open={Boolean(proxyItem)}
        width={680}
        footer={
          proxySubmission ? (
            <Space>
              <Button onClick={() => setProxyItem(null)}>取消</Button>
              <Button
                type="primary"
                loading={proxyWorking}
                disabled={!proxySubmission.files.some((file) => file.reviewStatus === "PENDING")}
                onClick={() => {
                  setProxyWorking(true);
                  void submitMaterialSubmission(proxySubmission.id)
                    .then(async () => {
                      if (studentId) await refresh(studentId);
                      setProxyItem(null);
                      messageApi.success("代传批次已提交，将由管理员审核");
                    })
                    .catch((error: unknown) =>
                      messageApi.error(error instanceof Error ? error.message : "提交失败"),
                    )
                    .finally(() => setProxyWorking(false));
                }}
              >
                提交管理员审核
              </Button>
            </Space>
          ) : null
        }
        onCancel={() => setProxyItem(null)}
      >
        <Alert
          type="warning"
          showIcon
          title="管家代传属于例外流程"
          description="必须记录原因；提交后由管理员审核，上传人不能审核自己的文件。"
          style={{ marginBottom: 16 }}
        />
        {!proxySubmission ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Input.TextArea
              rows={4}
              maxLength={1000}
              showCount
              value={proxyReason}
              placeholder="说明学生无法自行上传的具体原因"
              onChange={(event) => setProxyReason(event.target.value)}
            />
            <Button
              type="primary"
              loading={proxyWorking}
              disabled={!proxyReason.trim()}
              onClick={() => {
                if (!proxyItem) return;
                setProxyWorking(true);
                void createMaterialSubmission(proxyItem.id, proxyReason.trim())
                  .then(setProxySubmission)
                  .catch((error: unknown) =>
                    messageApi.error(error instanceof Error ? error.message : "无法建立代传批次"),
                  )
                  .finally(() => setProxyWorking(false));
              }}
            >
              记录原因并建立批次
            </Button>
          </Space>
        ) : (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Upload
              multiple
              showUploadList={false}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              beforeUpload={(file) => {
                setProxyWorking(true);
                void addMaterialSubmissionFile(proxySubmission.id, file)
                  .then((created) =>
                    setProxySubmission((current) =>
                      current ? { ...current, files: [...current.files, created] } : current,
                    ),
                  )
                  .catch((error: unknown) =>
                    messageApi.error(error instanceof Error ? error.message : "文件上传失败"),
                  )
                  .finally(() => setProxyWorking(false));
                return false;
              }}
            >
              <Button block type="dashed" icon={<CloudUploadOutlined />} loading={proxyWorking}>
                选择一个或多个文件
              </Button>
            </Upload>
            <List
              bordered
              dataSource={proxySubmission.files}
              locale={{ emptyText: "尚未选择文件" }}
              renderItem={(file) => (
                <List.Item
                  actions={[
                    <Button
                      key="remove"
                      size="small"
                      danger
                      disabled={file.reviewStatus === "APPROVED"}
                      onClick={() =>
                        void removeMaterialSubmissionFile(
                          proxySubmission.id,
                          file.id,
                          "管家在提交前移除文件",
                        ).then(setProxySubmission)
                      }
                    >
                      移除
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={file.fileName}
                    description={`${formatSize(file.fileSize)} · ${file.reviewStatus === "APPROVED" ? "沿用已通过文件" : "待提交"}`}
                  />
                </List.Item>
              )}
            />
          </Space>
        )}
      </Modal>

      <Modal
        title={reviewSubmission ? `审核第 ${reviewSubmission.submissionNo} 批资料` : "审核资料"}
        open={Boolean(reviewSubmission)}
        width={760}
        okText="提交审核结论"
        cancelText="稍后处理"
        confirmLoading={reviewWorking}
        onCancel={() => setReviewSubmission(null)}
        onOk={() => void submitReview()}
      >
        <Space orientation="vertical" size={14} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            title="逐文件审核"
            description="已通过的沿用文件不会重复审核；只需处理本批新增或替换的文件。"
            action={
              <Button
                size="small"
                onClick={() =>
                  setReviewDecisions(
                    Object.fromEntries(
                      pendingReviewFiles.map((file) => [file.id, { outcome: "APPROVED" }]),
                    ),
                  )
                }
              >
                全部标记通过
              </Button>
            }
          />
          {pendingReviewFiles.map((file) => {
            const decision = reviewDecisions[file.id];
            return (
              <Card key={file.id} size="small">
                <Space orientation="vertical" size={10} style={{ width: "100%" }}>
                  <Space wrap style={{ justifyContent: "space-between", width: "100%" }}>
                    <span>
                      <strong>{file.fileName}</strong> · {formatSize(file.fileSize)}
                    </span>
                    <Button
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setPreviewFile(file)}
                    >
                      查看文件
                    </Button>
                  </Space>
                  <Radio.Group
                    value={decision?.outcome}
                    options={[
                      { label: "文件通过", value: "APPROVED" },
                      { label: "需要补正", value: "CORRECTION_REQUIRED" },
                    ]}
                    onChange={(event) =>
                      setReviewDecisions((current) => ({
                        ...current,
                        [file.id]: {
                          outcome: event.target.value as "APPROVED" | "CORRECTION_REQUIRED",
                        },
                      }))
                    }
                  />
                  {decision?.outcome === "CORRECTION_REQUIRED" ? (
                    <Input.TextArea
                      rows={2}
                      placeholder="指出这个文件需要补正的问题"
                      value={decision.comment}
                      onChange={(event) =>
                        setReviewDecisions((current) => ({
                          ...current,
                          [file.id]: { ...current[file.id]!, comment: event.target.value },
                        }))
                      }
                    />
                  ) : null}
                </Space>
              </Card>
            );
          })}
          <Divider style={{ margin: "4px 0" }} />
          <Input.TextArea
            rows={3}
            maxLength={1000}
            showCount
            placeholder="总体审核意见；需要补正时必填"
            value={reviewComment}
            onChange={(event) => setReviewComment(event.target.value)}
          />
          <DatePicker
            showTime
            style={{ width: "100%" }}
            placeholder="补正截止时间；有问题文件时必填"
            onChange={(value) => setCorrectionDueAt(value?.toISOString() ?? null)}
          />
        </Space>
      </Modal>

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </PermissionPage>
  );
}
