"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftOutlined, CheckCircleOutlined, CopyOutlined } from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  Result,
  Row,
  Select,
  Skeleton,
  Space,
  Steps,
  Typography,
} from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { useAuth } from "../auth/auth-context";
import { PermissionPage } from "../auth/permission-page";
import {
  activateStudentService,
  checkStudentNameDuplicates,
  createStudent,
  getResponsiblePersonOptions,
} from "./student-api";
import type { ResponsiblePersonOptions, StudentFormValues, StudentRecord } from "./student-types";
import styles from "./student-page.module.css";

interface ActivationResult {
  studentId: string;
  studentName: string;
  account: { username: string; temporaryPassword: string; expiresAt: string };
}

export function StudentOnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<StudentFormValues>();
  const administrator = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_WRITE));
  const butler = Boolean(
    user?.roles.includes(RoleCode.BUTLER) &&
    user.permissions.includes(PermissionCode.STUDENTS_OWN_WRITE),
  );
  const mine = !administrator;
  const confirmationStep = administrator ? 2 : 1;
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<ResponsiblePersonOptions>({ butlers: [], planners: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<StudentRecord>();
  const [activation, setActivation] = useState<ActivationResult>();
  const [confirmedDuplicateName, setConfirmedDuplicateName] = useState<string>();

  useEffect(() => {
    let active = true;
    if (!administrator) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(true);
    getResponsiblePersonOptions()
      .then((result) => {
        if (active) setOptions(result);
      })
      .catch((exception: unknown) => {
        if (active) {
          setError(exception instanceof Error ? exception.message : "服务人员数据加载失败");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [administrator]);

  const confirmDuplicateIfNeeded = async () => {
    const name = form.getFieldValue("name")?.trim();
    if (!name || confirmedDuplicateName === name) return true;
    const duplicate = await checkStudentNameDuplicates(name, mine);
    if (!duplicate.hasDuplicates) return true;
    return new Promise<boolean>((resolve) => {
      modal.confirm({
        title: `发现 ${duplicate.count} 名同名学生`,
        content: "请先核对是否已经建档。确认不是重复记录后，仍可继续创建。",
        okText: "确认仍然创建",
        cancelText: "返回核对",
        onOk: () => {
          setConfirmedDuplicateName(name);
          resolve(true);
        },
        onCancel: () => resolve(false),
      });
    });
  };

  if (activation) {
    const onboardingMessage = [
      `${activation.studentName}，你的 DSE 升学服务账号已开通。`,
      `登录账号：${activation.account.username}`,
      `临时密码：${activation.account.temporaryPassword}`,
      "首次登录后请立即设置正式密码。",
    ].join("\n");
    return (
      <PermissionPage
        anyPermissions={[PermissionCode.STUDENTS_WRITE, PermissionCode.STUDENTS_OWN_WRITE]}
      >
        <main className={styles.page}>
          <section className={styles.formSurface}>
            <Result
              status="success"
              icon={<CheckCircleOutlined />}
              title="学生已创建，账号和服务已启用"
              subTitle="临时密码只在本页显示一次；关闭页面后如有需要，只能重置密码。"
              extra={[
                <Button
                  key="copy"
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(onboardingMessage);
                    await message.success("账号信息已复制");
                  }}
                >
                  复制账号信息
                </Button>,
                <Button
                  key="detail"
                  onClick={() => router.push(`/workspace/students/${activation.studentId}`)}
                >
                  查看学生详情
                </Button>,
                <Button key="another" onClick={() => window.location.reload()}>
                  继续新建学生
                </Button>,
              ]}
            />
            <Card title="学生登录凭证" style={{ maxWidth: 640, margin: "0 auto 32px" }}>
              <Descriptions column={1} bordered>
                <Descriptions.Item label="登录账号">
                  <Typography.Text copyable>{activation.account.username}</Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="一次性临时密码">
                  <Typography.Text code strong copyable>
                    {activation.account.temporaryPassword}
                  </Typography.Text>
                </Descriptions.Item>
                <Descriptions.Item label="有效期">
                  {new Intl.DateTimeFormat("zh-HK", {
                    timeZone: "Asia/Hong_Kong",
                    dateStyle: "long",
                    timeStyle: "short",
                  }).format(new Date(activation.account.expiresAt))}
                </Descriptions.Item>
              </Descriptions>
              <Alert
                type="warning"
                showIcon
                title="学生首次登录后必须设置正式密码"
                description="关闭本页后不再展示临时密码；管理员或负责管家可以在需要时重置账号。"
                style={{ marginTop: 16 }}
              />
            </Card>
          </section>
        </main>
      </PermissionPage>
    );
  }

  const values = form.getFieldsValue();
  const stepItems = administrator
    ? [{ title: "学生信息" }, { title: "服务团队" }, { title: "确认开通" }]
    : [{ title: "学生信息" }, { title: "确认开通" }];

  return (
    <PermissionPage
      anyPermissions={[PermissionCode.STUDENTS_WRITE, PermissionCode.STUDENTS_OWN_WRITE]}
    >
      <main className={styles.page}>
        <Link href="/workspace/students" className={styles.backLink}>
          <ArrowLeftOutlined aria-hidden />
          返回学生管理
        </Link>
        <section className={styles.compactHero}>
          <span className={styles.eyebrow}>Student onboarding</span>
          <h1 className={styles.compactTitle}>新建学生并开通账号</h1>
          <p className={styles.lead}>
            {administrator
              ? "选择负责管家后即可开通；规划老师可以现在分配，也可以稍后在管理员待办中处理。"
              : "只需填写学生姓名。系统会把你设为负责管家，并提醒管理员分配规划老师。"}
          </p>
        </section>
        <section className={styles.formSurface} aria-busy={loading || submitting}>
          <Steps current={step} responsive items={stepItems} style={{ marginBottom: 32 }} />
          {error ? (
            <Alert
              type="error"
              showIcon
              title={error}
              description={
                draft ? (
                  <Link href={`/workspace/students/${draft.id}`}>
                    学生已经创建，但账号尚未开通；可前往详情继续处理
                  </Link>
                ) : undefined
              }
              style={{ marginBottom: 20 }}
            />
          ) : null}
          {loading ? (
            <Skeleton active paragraph={{ rows: 7 }} />
          ) : (
            <Form<StudentFormValues> form={form} layout="vertical" requiredMark={false}>
              <div style={{ display: step === 0 ? "block" : "none" }}>
                <Typography.Title level={3}>学生信息</Typography.Title>
                <Typography.Paragraph type="secondary">
                  只有姓名是必填项，其他资料由学生拿到账号后在平台补全。
                </Typography.Paragraph>
                <Row gutter={16}>
                  <Col span={24}>
                    <Form.Item
                      label="学生姓名"
                      name="name"
                      rules={[
                        { required: true, whitespace: true, message: "请输入学生姓名" },
                        { max: 100, message: "姓名不能超过100个字符" },
                      ]}
                    >
                      <Input
                        size="large"
                        placeholder="例如：黄翰"
                        autoComplete="name"
                        onChange={() => setConfirmedDuplicateName(undefined)}
                      />
                    </Form.Item>
                  </Col>
                  {administrator ? (
                    <>
                      <Col xs={24} md={12}>
                        <Form.Item
                          label="联系电话（可选）"
                          name="phone"
                          rules={[
                            {
                              pattern: /^[0-9+\-()\s]{5,32}$/,
                              message: "请输入有效的联系电话",
                            },
                          ]}
                        >
                          <Input size="large" placeholder="+852 6123 4567" autoComplete="tel" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          label="联系邮箱（可选）"
                          name="email"
                          rules={[{ type: "email", message: "请输入有效的邮箱地址" }]}
                        >
                          <Input
                            size="large"
                            placeholder="student@example.com"
                            autoComplete="email"
                          />
                        </Form.Item>
                      </Col>
                    </>
                  ) : null}
                </Row>
              </div>

              {administrator ? (
                <div style={{ display: step === 1 ? "block" : "none" }}>
                  <Typography.Title level={3}>分配服务团队</Typography.Title>
                  <Typography.Paragraph type="secondary">
                    管家必须确定；规划老师暂未确定时不会阻塞账号开通。
                  </Typography.Paragraph>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="负责管家"
                        name="defaultButlerId"
                        rules={[{ required: true, message: "请选择负责管家" }]}
                      >
                        <Select
                          size="large"
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择管家"
                          options={options.butlers.map((person) => ({
                            value: person.id,
                            label: person.displayName,
                          }))}
                          notFoundContent="暂无可用管家"
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="规划老师（可稍后分配）" name="plannerId">
                        <Select
                          size="large"
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="暂不分配"
                          options={options.planners.map((person) => ({
                            value: person.id,
                            label: person.displayName,
                          }))}
                          notFoundContent="暂无可用规划老师"
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
              ) : null}

              <div style={{ display: step === confirmationStep ? "block" : "none" }}>
                <Typography.Title level={3}>确认开通</Typography.Title>
                <Alert
                  type="info"
                  showIcon
                  title="提交后一次完成创建和开通"
                  description="系统将建立学生记录、生成登录账号与临时密码、启动服务并生成任务。学生可登录后继续补全资料。"
                  style={{ marginBottom: 20 }}
                />
                <Descriptions bordered column={1}>
                  <Descriptions.Item label="学生姓名">{values.name}</Descriptions.Item>
                  <Descriptions.Item label="负责管家">
                    {administrator
                      ? options.butlers.find((person) => person.id === values.defaultButlerId)
                          ?.displayName
                      : user?.displayName}
                  </Descriptions.Item>
                  <Descriptions.Item label="规划老师">
                    {administrator && values.plannerId
                      ? options.planners.find((person) => person.id === values.plannerId)
                          ?.displayName
                      : "待管理员分配"}
                  </Descriptions.Item>
                  <Descriptions.Item label="登录账号">系统根据学生编号自动生成</Descriptions.Item>
                  <Descriptions.Item label="临时密码">创建成功后仅显示一次</Descriptions.Item>
                </Descriptions>
              </div>

              <div className={styles.formFooter}>
                <Space>
                  {step > 0 ? (
                    <Button onClick={() => setStep((value) => value - 1)}>上一步</Button>
                  ) : null}
                </Space>
                {step < confirmationStep ? (
                  <Button
                    type="primary"
                    onClick={async () => {
                      try {
                        const fields =
                          step === 0
                            ? administrator
                              ? ["name", "phone", "email"]
                              : ["name"]
                            : ["defaultButlerId"];
                        await form.validateFields(fields);
                        if (step === 0 && !(await confirmDuplicateIfNeeded())) return;
                        setError(undefined);
                        setStep((value) => value + 1);
                      } catch (exception) {
                        if (exception instanceof Error) setError(exception.message);
                      }
                    }}
                  >
                    下一步
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    loading={submitting}
                    disabled={!administrator && !butler}
                    onClick={async () => {
                      setSubmitting(true);
                      setError(undefined);
                      try {
                        const valuesToSubmit = await form.validateFields();
                        if (!draft && !(await confirmDuplicateIfNeeded())) return;
                        const student = draft ?? (await createStudent(valuesToSubmit, mine));
                        setDraft(student);
                        const result = await activateStudentService(
                          student.id,
                          student.version,
                          mine,
                        );
                        setActivation({
                          studentId: student.id,
                          studentName: student.name,
                          account: result.account,
                        });
                      } catch (exception) {
                        setError(
                          exception instanceof Error ? exception.message : "开通失败，请重试",
                        );
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                  >
                    创建学生并开通账号
                  </Button>
                )}
              </div>
            </Form>
          )}
        </section>
      </main>
    </PermissionPage>
  );
}
