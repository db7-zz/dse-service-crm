"use client";

import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
} from "antd";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import {
  getPortalProfile,
  submitPortalProfile,
  type PortalProfileData,
} from "../../../src/portal/portal-api";

const COMMON_SUBJECTS = [
  "中国语文",
  "英国语文",
  "数学必修部分",
  "公民与社会发展",
  "物理",
  "化学",
  "生物",
  "经济",
  "企业、会计与财务概论",
  "地理",
  "历史",
  "中国历史",
  "资讯及通讯科技",
  "视觉艺术",
];

const STATUS_LABEL = {
  INFORMATION_PENDING: "待填写",
  PENDING_REVIEW: "待管家确认",
  CONFIRMED: "档案已确认",
  PLANNER_ASSIGNED: "已进入规划服务",
} as const;

export default function PortalProfilePage() {
  const { message } = App.useApp();
  const [form] = Form.useForm<PortalProfileData>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<keyof typeof STATUS_LABEL>("INFORMATION_PENDING");

  useEffect(() => {
    getPortalProfile()
      .then((result) => {
        setStatus(result.profileStatus);
        form.setFieldsValue({
          ...(result.official as PortalProfileData),
          ...(result.submission?.data ?? {}),
          scoreSummary:
            result.submission?.data.scoreSummary ?? result.official.scoreSummary ?? "暂无",
          targetDirection:
            result.submission?.data.targetDirection ?? result.official.targetDirection ?? "待评估",
        });
      })
      .catch((error: unknown) =>
        message.error(error instanceof Error ? error.message : "基本信息加载失败"),
      )
      .finally(() => setLoading(false));
  }, [form, message]);

  return (
    <>
      <PortalPageTitle
        title="基本信息表"
        description="学生或家长只需在线填写一次。提交后由管家核对，确认前不会直接覆盖正式档案。"
      />
      {loading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <Card
          title={
            <Space>
              建档最低信息
              <Tag
                color={
                  status === "PENDING_REVIEW"
                    ? "processing"
                    : status === "CONFIRMED" || status === "PLANNER_ASSIGNED"
                      ? "success"
                      : "default"
                }
              >
                {STATUS_LABEL[status]}
              </Tag>
            </Space>
          }
        >
          <Alert
            type="info"
            showIcon
            title="资料不完整也不影响使用平台"
            description="成绩暂时没有可填“暂无”，目标方向未确定可填“待评估”。身份信息这里只填写申请路径摘要，证件扫描件请到资料清单上传。"
            style={{ marginBottom: 20 }}
          />
          <Form<PortalProfileData> form={form} layout="vertical" requiredMark="optional">
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="studentName"
                  label="学生姓名"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="cohortYear" label="DSE 届别" rules={[{ required: true }]}>
                  <InputNumber min={2000} max={2200} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="grade"
                  label="当前年级"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="例如：中六" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="school"
                  label="就读学校"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="studentPhone"
                  label="学生联系电话"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="studentWechat"
                  label="学生微信"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="parentName"
                  label="家长姓名"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="parentRelationship"
                  label="与学生关系"
                  rules={[{ required: true }]}
                >
                  <Select
                    options={["父亲", "母亲", "监护人", "其他"].map((value) => ({ value }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="parentPhone"
                  label="家长联系电话"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="parentWechat"
                  label="家长微信"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="identityCategory"
                  label="身份/申请路径摘要"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="例如：香港永久居民 / JUPAS" />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item
                  name="examCandidateType"
                  label="考生类别"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input placeholder="例如：学校考生" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  name="dseSubjects"
                  label="DSE 科目组合"
                  rules={[{ required: true, type: "array", min: 1 }]}
                >
                  <Select
                    mode="tags"
                    options={COMMON_SUBJECTS.map((value) => ({ value }))}
                    placeholder="选择或输入科目"
                  />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  name="scoreSummary"
                  label="当前成绩概况"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input.TextArea rows={3} placeholder="暂时没有可填写：暂无" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  name="targetDirection"
                  label="目标方向"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input.TextArea rows={3} placeholder="尚未确定可填写：待评估" />
                </Form.Item>
              </Col>
            </Row>
            <Button
              type="primary"
              size="large"
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await submitPortalProfile(await form.validateFields());
                  setStatus("PENDING_REVIEW");
                  await message.success("基本信息已提交，等待管家确认");
                } catch (error) {
                  if (error instanceof Error) await message.error(error.message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {status === "PENDING_REVIEW" ? "更新并重新提交" : "提交给管家确认"}
            </Button>
          </Form>
        </Card>
      )}
    </>
  );
}
