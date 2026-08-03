"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Upload,
  message,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { listStudents } from "../students/student-api";
import type { StudentRecord } from "../students/student-types";
import {
  createMaterial,
  getMaterials,
  getMaterialTypes,
  reviewMaterial,
  uploadMaterial,
} from "./operations-api";
import type { MaterialItemView } from "./operations-types";

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  REQUIRED: { text: "待提交", color: "default" },
  PENDING_REVIEW: { text: "待审核", color: "processing" },
  APPROVED: { text: "已通过", color: "success" },
  PARTIALLY_MISSING: { text: "部分缺失", color: "warning" },
  RESUBMISSION_REQUIRED: { text: "需重交", color: "error" },
  NOT_APPLICABLE: { text: "不适用", color: "default" },
};

export function MaterialsPage() {
  const { user } = useAuth();
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentId, setStudentId] = useState<string>();
  const [items, setItems] = useState<MaterialItemView[]>([]);
  const [summary, setSummary] = useState({
    total: 0,
    approved: 0,
    pendingReview: 0,
    missing: 0,
    missingCore: 0,
  });
  const [types, setTypes] = useState<Array<{ id: string; name: string; isCore: boolean }>>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);
  const canWrite = Boolean(user?.permissions.includes(PermissionCode.MATERIALS_WRITE));
  const canReview = Boolean(user?.permissions.includes(PermissionCode.MATERIALS_REVIEW));

  const refresh = useCallback(
    async (selectedStudentId: string) => {
      setLoading(true);
      try {
        const result = await getMaterials(selectedStudentId);
        setItems(result.items);
        setSummary(result.summary);
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
        const firstId = studentPage.items.some((student) => student.id === requestedId)
          ? requestedId!
          : studentPage.items[0]?.id;
        if (firstId) {
          setStudentId(firstId);
          void refresh(firstId);
        }
      })
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "初始化失败"),
      );
  }, [messageApi, mine, refresh]);

  return (
    <PermissionPage permission={PermissionCode.MATERIALS_READ}>
      {contextHolder}
      <PageShell
        title="资料管理"
        description="按学生集中收集、审核并保留不可覆盖的历史版本。"
        extra={
          canWrite && studentId ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新增资料项
            </Button>
          ) : null
        }
      >
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择学生"
            value={studentId}
            style={{ width: "min(100%, 420px)" }}
            options={students.map((student) => ({
              value: student.id,
              label: `${student.name} · ${student.studentNo}`,
            }))}
            onChange={(value) => {
              setStudentId(value);
              void refresh(value);
            }}
          />
          {studentId ? (
            <>
              <Row gutter={[12, 12]}>
                {[
                  ["资料项", summary.total],
                  ["已通过", summary.approved],
                  ["待审核", summary.pendingReview],
                  ["核心缺口", summary.missingCore],
                ].map(([title, value]) => (
                  <Col xs={12} md={6} key={String(title)}>
                    <Card size="small">
                      <Statistic title={title} value={value} />
                    </Card>
                  </Col>
                ))}
              </Row>
              <Table<MaterialItemView>
                rowKey="id"
                loading={loading}
                dataSource={items}
                pagination={false}
                locale={{ emptyText: <Empty description="暂无资料项" /> }}
                scroll={{ x: 960 }}
                columns={[
                  {
                    title: "资料",
                    dataIndex: "title",
                    render: (_value, item) => (
                      <Space direction="vertical" size={0}>
                        <strong>{item.title}</strong>
                        <span style={{ color: "#64748b" }}>
                          {item.materialType.name}
                          {item.materialType.isCore ? " · 核心" : ""}
                        </span>
                      </Space>
                    ),
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    width: 110,
                    render: (value: string) => {
                      const meta = STATUS_LABELS[value] ?? { text: value, color: "default" };
                      return <Tag color={meta.color}>{meta.text}</Tag>;
                    },
                  },
                  {
                    title: "当前版本",
                    width: 190,
                    render: (_value, item) =>
                      item.currentVersion ? (
                        <Space direction="vertical" size={0}>
                          <span>
                            v{item.currentVersion.versionNo} · {item.currentVersion.fileName}
                          </span>
                          <Tag>{item.currentVersion.reviewStatus}</Tag>
                        </Space>
                      ) : (
                        "尚未上传"
                      ),
                  },
                  {
                    title: "截止时间",
                    dataIndex: "dueAt",
                    width: 170,
                    render: (value: string | null) =>
                      value ? new Date(value).toLocaleString("zh-CN") : "—",
                  },
                  {
                    title: "操作",
                    fixed: "right",
                    width: 260,
                    render: (_value, item) => (
                      <Space wrap>
                        {canWrite ? (
                          <Upload
                            showUploadList={false}
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            beforeUpload={(file) => {
                              void uploadMaterial(item.id, file)
                                .then(() => {
                                  messageApi.success("新版本已上传");
                                  return refresh(item.studentId);
                                })
                                .catch((error: unknown) =>
                                  messageApi.error(
                                    error instanceof Error ? error.message : "上传失败",
                                  ),
                                );
                              return false;
                            }}
                          >
                            <Button size="small">上传新版本</Button>
                          </Upload>
                        ) : null}
                        {item.currentVersion ? (
                          <Button size="small" href={item.currentVersion.downloadUrl}>
                            下载
                          </Button>
                        ) : null}
                        {canReview && item.status === "PENDING_REVIEW" ? (
                          <Button
                            size="small"
                            type="primary"
                            onClick={() =>
                              void reviewMaterial(item.id, {
                                outcome: "APPROVED",
                                version: item.version,
                              })
                                .then(() => refresh(item.studentId))
                                .then(() => messageApi.success("资料已通过"))
                                .catch((error: unknown) =>
                                  messageApi.error(
                                    error instanceof Error ? error.message : "审核失败",
                                  ),
                                )
                            }
                          >
                            通过
                          </Button>
                        ) : null}
                        {canReview && item.status === "PENDING_REVIEW" ? (
                          <Button
                            size="small"
                            danger
                            onClick={() => {
                              const comment = window.prompt("请输入退回原因");
                              if (!comment) return;
                              void reviewMaterial(item.id, {
                                outcome: "RESUBMISSION_REQUIRED",
                                comment,
                                version: item.version,
                              })
                                .then(() => refresh(item.studentId))
                                .catch((error: unknown) =>
                                  messageApi.error(
                                    error instanceof Error ? error.message : "审核失败",
                                  ),
                                );
                            }}
                          >
                            退回
                          </Button>
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Empty description="当前没有可管理的学生" />
          )}
        </Space>
      </PageShell>
      <Modal
        title="新增资料项"
        open={createOpen}
        okText="创建"
        cancelText="取消"
        onCancel={() => setCreateOpen(false)}
        onOk={() =>
          void form
            .validateFields()
            .then(
              async (values: { materialTypeId: string; title: string; requirement?: string }) => {
                if (!studentId) return;
                await createMaterial(studentId, values);
                setCreateOpen(false);
                form.resetFields();
                await refresh(studentId);
                messageApi.success("资料项已创建");
              },
            )
            .catch((error: unknown) => {
              if (error instanceof Error) messageApi.error(error.message);
            })
        }
      >
        <Form form={form} layout="vertical">
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
          <Form.Item name="requirement" label="提交要求">
            <Input.TextArea rows={3} maxLength={1000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </PermissionPage>
  );
}
