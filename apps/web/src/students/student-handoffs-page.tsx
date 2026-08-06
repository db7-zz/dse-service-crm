"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckOutlined, CopyOutlined, PlusOutlined, TeamOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Skeleton,
  Space,
  Tag,
  Typography,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { getResponsiblePersonOptions } from "./student-api";
import type { ResponsiblePersonOptions } from "./student-types";
import {
  acceptStudentHandoff,
  createStudentHandoff,
  listStudentHandoffs,
  type HandoffFormValues,
  type StudentHandoff,
} from "./handoff-api";
import styles from "./student-page.module.css";

function localDateTimeValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const STATUS = {
  PENDING_ACCEPTANCE: { label: "待管家接手", color: "processing" },
  ACCEPTED: { label: "已接手并开通", color: "success" },
  CANCELED: { label: "已取消", color: "default" },
} as const;

export function StudentHandoffsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm<HandoffFormValues>();
  const [items, setItems] = useState<StudentHandoff[]>([]);
  const [options, setOptions] = useState<ResponsiblePersonOptions>({ butlers: [], planners: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [onboardingMessage, setOnboardingMessage] = useState<string>();
  const canCreate = Boolean(user?.permissions.includes(PermissionCode.STUDENT_HANDOFFS_WRITE));
  const canAccept = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_OWN_WRITE));

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setItems((await listStudentHandoffs()).items);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "签约交接加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (canCreate)
      void getResponsiblePersonOptions()
        .then(setOptions)
        .catch(() => undefined);
  }, [canCreate, refresh]);

  return (
    <PermissionPage permission={PermissionCode.STUDENT_HANDOFFS_READ}>
      <main className={styles.page}>
        <section className={styles.compactHero}>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>Signed student handoff</span>
            <h1 className={styles.compactTitle}>签约学生交接</h1>
            <p className={styles.lead}>
              管理员在服务群建立后发起交接；管家一次确认即可创建学生身份、开通账号并启动资料收集，无需重复录入完整档案。
            </p>
            {canCreate ? (
              <div className={styles.heroActions}>
                <Button
                  type="primary"
                  size="large"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateOpen(true)}
                >
                  新建签约交接
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        {error ? (
          <Alert
            type="error"
            showIcon
            title={error}
            action={<Button onClick={() => void refresh()}>重试</Button>}
          />
        ) : null}
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : items.length === 0 ? (
          <Card>
            <Empty
              description={
                canCreate ? "暂无签约交接，可在建立微信群后创建" : "当前没有分配给你的新生交接"
              }
            />
          </Card>
        ) : (
          <Row gutter={[16, 16]}>
            {items.map((item) => {
              const state = STATUS[item.status];
              return (
                <Col xs={24} xl={12} key={item.id}>
                  <Card
                    title={
                      <Space>
                        <TeamOutlined />
                        {item.studentName}
                        <Tag color={state.color}>{state.label}</Tag>
                      </Space>
                    }
                    extra={
                      item.student ? (
                        <Link href={`/workspace/students/${item.student.id}`}>查看学生</Link>
                      ) : null
                    }
                  >
                    <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                      <Descriptions.Item label="学生联系">
                        {item.studentPhone || item.studentWechat || "待补充"}
                      </Descriptions.Item>
                      <Descriptions.Item label="家长">
                        {item.parentName} · {item.parentPhone}
                      </Descriptions.Item>
                      <Descriptions.Item label="负责管家">
                        {item.assignedButler.displayName}
                      </Descriptions.Item>
                      <Descriptions.Item label="服务群建立">
                        {new Date(item.wechatGroupCreatedAt).toLocaleString("zh-CN")}
                      </Descriptions.Item>
                      <Descriptions.Item label="学校/年级">
                        {[item.school, item.grade].filter(Boolean).join(" · ") || "待补充"}
                      </Descriptions.Item>
                      <Descriptions.Item label="资料状态">
                        {item.student?.profileStatus === "PENDING_REVIEW"
                          ? "待管家确认"
                          : item.student?.profileStatus === "CONFIRMED"
                            ? "档案已确认"
                            : "待学生填写"}
                      </Descriptions.Item>
                    </Descriptions>
                    {canAccept && item.status === "PENDING_ACCEPTANCE" ? (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginTop: 16 }}
                        title="确认后立即开通学生端"
                        description="系统会自动生成账号和资料清单；不要求学生先交齐资料，也不要求先分配规划老师。"
                        action={
                          <Button
                            type="primary"
                            icon={<CheckOutlined />}
                            loading={submitting}
                            onClick={async () => {
                              setSubmitting(true);
                              try {
                                const result = await acceptStudentHandoff(item);
                                setOnboardingMessage(result.onboardingMessage);
                                await refresh();
                              } catch (exception) {
                                await message.error(
                                  exception instanceof Error ? exception.message : "接手失败",
                                );
                              } finally {
                                setSubmitting(false);
                              }
                            }}
                          >
                            确认接手并开通学生端
                          </Button>
                        }
                      />
                    ) : null}
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}

        <Modal
          title="新建签约学生交接"
          open={createOpen}
          width={760}
          okText="创建并通知管家"
          cancelText="取消"
          confirmLoading={submitting}
          onCancel={() => setCreateOpen(false)}
          onOk={async () => {
            setSubmitting(true);
            try {
              await createStudentHandoff(await form.validateFields());
              await message.success("交接已创建，管家会收到站内通知");
              setCreateOpen(false);
              form.resetFields();
              await refresh();
            } catch (exception) {
              if (exception instanceof Error) await message.error(exception.message);
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Alert
            type="info"
            showIcon
            title="这里只登记交接所需最少信息"
            description="完整档案由学生登录后填写，管家确认；管理员不需要替管家重复建档。"
            style={{ marginBottom: 20 }}
          />
          <Form<HandoffFormValues>
            form={form}
            layout="vertical"
            initialValues={{
              wechatGroupCreatedAt: localDateTimeValue(),
              cohortYear: new Date().getFullYear() + 1,
            }}
          >
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="studentName"
                  label="学生姓名"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="studentPhone" label="学生电话（可选）">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="studentWechat" label="学生微信（可选）">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="parentName"
                  label="家长姓名"
                  rules={[{ required: true, whitespace: true }]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="parentRelationship" label="与学生关系">
                  <Select
                    options={["父亲", "母亲", "监护人", "其他"].map((value) => ({ value }))}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="parentPhone"
                  label="家长联系电话"
                  rules={[
                    { required: true },
                    { pattern: /^[0-9+\-()\s]{5,32}$/, message: "请输入有效电话" },
                  ]}
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="parentWechat" label="家长微信（可选）">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="assignedButlerId"
                  label="负责管家"
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
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="school" label="学校（可选）">
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="grade" label="当前年级（可选）">
                  <Input placeholder="例如：中六" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="cohortYear" label="DSE 届别（可选）">
                  <InputNumber min={2000} max={2200} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item
                  name="wechatGroupCreatedAt"
                  label="服务群建立时间"
                  rules={[{ required: true }]}
                >
                  <Input type="datetime-local" />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>

        <Modal
          title="学生端已开通"
          open={Boolean(onboardingMessage)}
          onCancel={() => setOnboardingMessage(undefined)}
          footer={
            <Button type="primary" onClick={() => setOnboardingMessage(undefined)}>
              完成
            </Button>
          }
        >
          <Typography.Paragraph>下面的内容可直接复制到服务微信群：</Typography.Paragraph>
          <Input.TextArea value={onboardingMessage} autoSize={{ minRows: 8 }} readOnly />
          <Button
            icon={<CopyOutlined />}
            style={{ marginTop: 12 }}
            onClick={async () => {
              await navigator.clipboard.writeText(onboardingMessage ?? "");
              await message.success("入群消息已复制");
            }}
          >
            复制入群消息
          </Button>
        </Modal>
      </main>
    </PermissionPage>
  );
}
