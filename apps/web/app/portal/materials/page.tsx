"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudUploadOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
  Modal,
  Progress,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import Link from "next/link";
import { FilePreviewModal, type PreviewFile } from "../../../src/files/file-preview-modal";
import {
  addPortalMaterialSubmissionFile,
  createPortalMaterialSubmission,
  getPortalMaterials,
  removePortalMaterialSubmissionFile,
  requestPortalMaterialNotApplicable,
  submitPortalMaterialSubmission,
  withdrawPortalMaterialSubmission,
  type PortalMaterial,
  type PortalMaterialSubmission,
  type PortalMaterialSubmissionFile,
} from "../../../src/portal/portal-api";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import styles from "../../../src/portal/portal-materials.module.css";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  REQUIRED: { label: "待准备", color: "default" },
  DRAFT: { label: "草稿中", color: "cyan" },
  PENDING_REVIEW: { label: "待管家审核", color: "processing" },
  IN_REVIEW: { label: "审核中", color: "blue" },
  APPROVED: { label: "已完成", color: "success" },
  NEEDS_CORRECTION: { label: "需要补正", color: "error" },
  PARTIALLY_MISSING: { label: "部分缺失", color: "warning" },
  RESUBMISSION_REQUIRED: { label: "需要重交", color: "error" },
  AWAITING_CONFIRMATION: { label: "等待确认", color: "gold" },
  NOT_APPLICABLE: { label: "不适用", color: "default" },
  CANCELED: { label: "已取消", color: "default" },
};

function statusTag(status: string) {
  const meta = STATUS_LABELS[status] ?? { label: status, color: "default" };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未设置";
}

function formatSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

type FilterKey = "ALL" | "ACTION" | "REVIEW" | "DONE";

export default function PortalMaterialsPage() {
  const [items, setItems] = useState<PortalMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [batchMaterial, setBatchMaterial] = useState<PortalMaterial | null>(null);
  const [draft, setDraft] = useState<PortalMaterialSubmission | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPortalMaterials();
      setItems(result.items);
      setBatchMaterial((current) =>
        current ? (result.items.find((item) => item.id === current.id) ?? null) : null,
      );
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "资料加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(
    () => ({
      total: items.length,
      action: items.filter((item) =>
        [
          "REQUIRED",
          "NEEDS_CORRECTION",
          "PARTIALLY_MISSING",
          "RESUBMISSION_REQUIRED",
          "DRAFT",
        ].includes(item.status),
      ).length,
      review: items.filter((item) => ["PENDING_REVIEW", "IN_REVIEW"].includes(item.status)).length,
      approved: items.filter((item) => item.status === "APPROVED").length,
    }),
    [items],
  );

  const progress = counts.total ? Math.round((counts.approved / counts.total) * 100) : 0;
  const visibleItems = useMemo(() => {
    if (filter === "ACTION") {
      return items.filter((item) =>
        [
          "REQUIRED",
          "NEEDS_CORRECTION",
          "PARTIALLY_MISSING",
          "RESUBMISSION_REQUIRED",
          "DRAFT",
        ].includes(item.status),
      );
    }
    if (filter === "REVIEW") {
      return items.filter((item) => ["PENDING_REVIEW", "IN_REVIEW"].includes(item.status));
    }
    if (filter === "DONE") {
      return items.filter((item) =>
        ["APPROVED", "NOT_APPLICABLE", "CANCELED"].includes(item.status),
      );
    }
    return items;
  }, [filter, items]);

  const groups = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; sequenceNo: number; items: PortalMaterial[] }
    >();
    for (const item of visibleItems) {
      const stage = item.sopMaterialTemplate?.stage;
      const key = stage?.stageCode ?? "SPECIAL";
      const group = grouped.get(key) ?? {
        name: stage?.name ?? "特殊资料",
        sequenceNo: stage?.sequenceNo ?? 99,
        items: [],
      };
      group.items.push(item);
      grouped.set(key, group);
    }
    return [...grouped.values()].sort((left, right) => left.sequenceNo - right.sequenceNo);
  }, [visibleItems]);

  const openBatch = async (item: PortalMaterial) => {
    setBatchMaterial(item);
    const existingDraft =
      item.currentSubmission?.status === "DRAFT" ? item.currentSubmission : null;
    if (existingDraft) {
      setDraft(existingDraft);
      return;
    }
    setBatchWorking(true);
    try {
      setDraft(await createPortalMaterialSubmission(item.id));
    } catch (error) {
      setBatchMaterial(null);
      messageApi.error(error instanceof Error ? error.message : "无法建立上传草稿");
    } finally {
      setBatchWorking(false);
    }
  };

  const submitBatch = async () => {
    if (!draft) return;
    setBatchWorking(true);
    try {
      await submitPortalMaterialSubmission(draft.id);
      setBatchMaterial(null);
      setDraft(null);
      await refresh();
      messageApi.success("资料已提交审核");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBatchWorking(false);
    }
  };

  const requestNotApplicable = (item: PortalMaterial) => {
    let reason = "";
    Modal.confirm({
      title: `申请将“${item.title}”标记为不适用`,
      content: (
        <Input.TextArea
          rows={4}
          maxLength={1000}
          style={{ marginTop: 12 }}
          placeholder="说明为什么你的情况不需要提交这项资料"
          onChange={(event) => (reason = event.target.value)}
        />
      ),
      okText: "提交申请",
      cancelText: "取消",
      onOk: async () => {
        if (!reason.trim()) throw new Error("请填写申请原因");
        await requestPortalMaterialNotApplicable(item.id, reason.trim());
        await refresh();
        messageApi.success("不适用申请已提交给管家");
      },
    });
  };

  const withdraw = (submission: PortalMaterialSubmission) => {
    let reason = "";
    Modal.confirm({
      title: "撤回本次提交？",
      content: (
        <Input.TextArea
          rows={3}
          style={{ marginTop: 12 }}
          placeholder="填写撤回原因"
          onChange={(event) => (reason = event.target.value)}
        />
      ),
      okText: "确认撤回",
      cancelText: "取消",
      onOk: async () => {
        if (!reason.trim()) throw new Error("请填写撤回原因");
        await withdrawPortalMaterialSubmission(submission.id, reason.trim());
        await refresh();
        messageApi.success("提交已撤回");
      },
    });
  };

  const renderFile = (file: PortalMaterialSubmissionFile) => (
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
        avatar={<FileTextOutlined className={styles.fileIcon} />}
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

  const materialCard = (item: PortalMaterial) => {
    const submission = item.currentSubmission;
    const canPrepare = [
      "REQUIRED",
      "NEEDS_CORRECTION",
      "PARTIALLY_MISSING",
      "RESUBMISSION_REQUIRED",
      "AWAITING_CONFIRMATION",
      "DRAFT",
    ].includes(item.status);
    return (
      <Col xs={24} xl={12} key={item.id}>
        <Card className={styles.materialCard} styles={{ body: { padding: 0 } }}>
          <div className={styles.cardTop}>
            <div className={styles.cardTitleBlock}>
              <Space wrap>
                <Typography.Title level={4}>{item.title}</Typography.Title>
                {item.requirementKind === "REQUIRED" ? <Tag color="red">必交</Tag> : null}
                {item.requirementKind === "CONDITIONAL" ? <Tag color="orange">条件必交</Tag> : null}
                {item.requirementKind === "OPTIONAL" ? <Tag>选交</Tag> : null}
              </Space>
              <Typography.Text type="secondary">截止：{formatDate(item.dueAt)}</Typography.Text>
            </div>
            {statusTag(item.status)}
          </div>
          <div className={styles.cardBody}>
            <p className={styles.requirement}>{item.requirement ?? "按管家说明准备资料。"}</p>
            {item.missingReason || submission?.reviewComment ? (
              <Alert
                type="warning"
                showIcon
                title="需要处理"
                description={submission?.reviewComment ?? item.missingReason}
              />
            ) : null}
            {item.materialType.inputMode === "SECURE_REFERENCE" ? (
              <Alert
                type="warning"
                showIcon
                title="请勿上传账号密码"
                description="管家会在对应阶段告知安全交付方式。"
              />
            ) : null}
            {submission?.files.length ? (
              <List
                size="small"
                className={styles.fileList}
                dataSource={submission.files}
                renderItem={renderFile}
              />
            ) : item.currentVersion ? (
              <List
                size="small"
                className={styles.fileList}
                dataSource={[
                  {
                    id: item.currentVersion.id,
                    fileName: item.currentVersion.fileName,
                    mimeType: item.currentVersion.mimeType ?? "application/octet-stream",
                    fileSize: item.currentVersion.fileSize ?? 0,
                    uploadedAt: item.currentVersion.uploadedAt,
                    reviewStatus: item.currentVersion.reviewStatus as
                      "PENDING" | "APPROVED" | "REJECTED",
                    reviewComment: item.currentVersion.reviewComment,
                    copiedFromFileId: null,
                    downloadUrl:
                      item.currentVersion.downloadUrl ??
                      `/api/v1/portal/me/material-versions/${item.currentVersion.id}/download`,
                    previewUrl: item.currentVersion.previewUrl,
                  },
                ]}
                renderItem={renderFile}
              />
            ) : null}
          </div>
          <div className={styles.cardActions}>
            {item.materialType.inputMode === "FORM" ? (
              <Link href="/portal/profile">
                <Button type="primary">填写基本信息表</Button>
              </Link>
            ) : null}
            {item.materialType.inputMode === "FILE" && canPrepare ? (
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                loading={batchWorking && batchMaterial?.id === item.id}
                onClick={() => void openBatch(item)}
              >
                {item.status === "DRAFT"
                  ? "继续准备提交"
                  : item.status === "NEEDS_CORRECTION"
                    ? "补正文件"
                    : "准备并上传"}
              </Button>
            ) : null}
            {submission?.status === "PENDING_REVIEW" && !submission.reviewStartedAt ? (
              <Button onClick={() => withdraw(submission)}>撤回提交</Button>
            ) : null}
            {canPrepare && item.materialType.inputMode !== "SECURE_REFERENCE" ? (
              <Button type="link" onClick={() => requestNotApplicable(item)}>
                这项资料不适用于我
              </Button>
            ) : null}
          </div>
        </Card>
      </Col>
    );
  };

  return (
    <>
      {contextHolder}
      <PortalPageTitle
        title="我的资料"
        description="全部阶段资料都可以提前准备；选择文件后先形成草稿，确认无误再一次提交审核。"
      />
      <Card className={styles.overviewCard}>
        <div className={styles.progressBlock}>
          <div>
            <span className={styles.eyebrow}>资料完成度</span>
            <strong>{progress}%</strong>
          </div>
          <Progress percent={progress} showInfo={false} strokeColor="#1677ff" />
        </div>
        <Row gutter={[12, 12]}>
          {[
            ["全部资料", counts.total, <InboxOutlined key="all" />],
            ["需要处理", counts.action, <ClockCircleOutlined key="action" />],
            ["审核中", counts.review, <FileDoneOutlined key="review" />],
            ["已完成", counts.approved, <CheckCircleOutlined key="done" />],
          ].map(([label, value, icon]) => (
            <Col xs={12} md={6} key={String(label)}>
              <div className={styles.metric}>
                <span>{icon}</span>
                <div>
                  <strong>{String(value)}</strong>
                  <small>{label}</small>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>
      <div className={styles.filterBar}>
        <Segmented<FilterKey>
          block
          value={filter}
          options={[
            { label: "全部", value: "ALL" },
            { label: `待处理 ${counts.action}`, value: "ACTION" },
            { label: `审核中 ${counts.review}`, value: "REVIEW" },
            { label: "已完成", value: "DONE" },
          ]}
          onChange={setFilter}
        />
      </div>
      {loading ? (
        <Row gutter={[16, 16]}>
          {[1, 2, 3, 4].map((key) => (
            <Col xs={24} xl={12} key={key}>
              <Card loading />
            </Col>
          ))}
        </Row>
      ) : groups.length ? (
        <Space orientation="vertical" size={26} style={{ width: "100%" }}>
          {groups.map((group) => (
            <section key={`${group.sequenceNo}-${group.name}`}>
              <div className={styles.stageHeading}>
                <span>{group.sequenceNo < 99 ? `阶段 ${group.sequenceNo}` : "补充"}</span>
                <Typography.Title level={3}>{group.name}</Typography.Title>
                <Typography.Text type="secondary">{group.items.length} 项</Typography.Text>
              </div>
              <Row gutter={[16, 16]}>{group.items.map(materialCard)}</Row>
            </section>
          ))}
        </Space>
      ) : (
        <Empty description={items.length ? "当前筛选下没有资料" : "暂无资料项"} />
      )}

      <Modal
        title={batchMaterial ? `准备提交 · ${batchMaterial.title}` : "准备提交"}
        open={Boolean(batchMaterial)}
        width="min(720px, calc(100vw - 24px))"
        okText="确认提交审核"
        cancelText="保存草稿，稍后继续"
        confirmLoading={batchWorking}
        okButtonProps={{
          disabled: !draft?.files.some((file) => file.reviewStatus === "PENDING"),
        }}
        onCancel={() => {
          setBatchMaterial(null);
          setDraft(null);
        }}
        onOk={() => void submitBatch()}
      >
        <Alert
          type="info"
          showIcon
          title="先准备文件，再统一提交"
          description="可一次选择多个文件；提交前都可以移除。补正时，已通过的文件会自动沿用。"
          style={{ marginBottom: 16 }}
        />
        {draft ? (
          <Space orientation="vertical" size={14} style={{ width: "100%" }}>
            <Upload.Dragger
              multiple
              showUploadList={false}
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
              disabled={batchWorking}
              beforeUpload={(file) => {
                setBatchWorking(true);
                void addPortalMaterialSubmissionFile(draft.id, file)
                  .then((created) =>
                    setDraft((current) =>
                      current ? { ...current, files: [...current.files, created] } : current,
                    ),
                  )
                  .catch((error: unknown) =>
                    messageApi.error(error instanceof Error ? error.message : "文件上传失败"),
                  )
                  .finally(() => setBatchWorking(false));
                return false;
              }}
            >
              <p className="ant-upload-drag-icon">
                <CloudUploadOutlined />
              </p>
              <p className="ant-upload-text">点击或拖入一个或多个文件</p>
              <p className="ant-upload-hint">支持 PDF、Word、JPG、PNG，单个文件不超过系统限制</p>
            </Upload.Dragger>
            <List
              bordered
              dataSource={draft.files}
              locale={{ emptyText: "尚未选择文件" }}
              renderItem={(file) => (
                <List.Item
                  actions={[
                    <Button
                      key="view"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setPreviewFile(file)}
                    >
                      查看
                    </Button>,
                    <Button
                      key="remove"
                      size="small"
                      danger
                      disabled={file.reviewStatus === "APPROVED"}
                      onClick={() => {
                        setBatchWorking(true);
                        void removePortalMaterialSubmissionFile(draft.id, file.id)
                          .then(setDraft)
                          .catch((error: unknown) =>
                            messageApi.error(
                              error instanceof Error ? error.message : "移除文件失败",
                            ),
                          )
                          .finally(() => setBatchWorking(false));
                      }}
                    >
                      {file.reviewStatus === "APPROVED" ? "已沿用" : "移除"}
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={file.fileName}
                    description={`${formatSize(file.fileSize)} · ${file.reviewStatus === "APPROVED" ? "上一批已通过，自动沿用" : "本批新文件"}`}
                  />
                </List.Item>
              )}
            />
          </Space>
        ) : null}
      </Modal>
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  );
}
