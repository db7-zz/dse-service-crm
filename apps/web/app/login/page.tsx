"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useAuth } from "../../src/auth/auth-context";
import { defaultRouteFor } from "../../src/navigation/navigation";
import styles from "./login.module.css";

export default function LoginPage() {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { user, loading, login } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace(defaultRouteFor(user));
    }
  }, [loading, router, user]);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.form}>
          <Space orientation="vertical" size={8} style={{ marginBottom: 32 }}>
            <Typography.Text type="secondary">DSE升学服务CRM</Typography.Text>
            <Typography.Title level={1} style={{ margin: 0 }}>
              登录内部管理端
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              使用管理员、业务负责人或服务团队账号登录
            </Typography.Paragraph>
          </Space>
          {error ? (
            <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />
          ) : null}
          <Form
            layout="vertical"
            size="large"
            onFinish={async (values: { username: string; password: string }) => {
              setSubmitting(true);
              setError(undefined);
              try {
                const current = await login(values.username, values.password);
                const requested = new URLSearchParams(window.location.search).get("next");
                router.replace(
                  requested?.startsWith("/workspace") ? requested : defaultRouteFor(current),
                );
              } catch (exception) {
                setError(exception instanceof Error ? exception.message : "登录失败，请稍后重试");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              name="username"
              label="登录账号"
              rules={[{ required: true, message: "请输入登录账号" }]}
            >
              <Input prefix={<UserOutlined />} autoComplete="username" placeholder="请输入账号" />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[
                { required: true, message: "请输入密码" },
                { min: 6, message: "密码不少于6位" },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              登录
            </Button>
          </Form>
          <Typography.Paragraph type="secondary" style={{ marginTop: 24 }}>
            账号停用、锁定或无法登录时，请联系管理员处理。
          </Typography.Paragraph>
        </div>
      </section>
      <aside className={styles.visual}>
        <div className={styles.visualContent}>
          <Typography.Title style={{ color: "#fff", fontSize: 42 }}>
            让服务过程清晰、可靠、可追溯
          </Typography.Title>
          <Typography.Paragraph style={{ color: "rgb(255 255 255 / 76%)", fontSize: 17 }}>
            阶段0已建立安全认证、角色权限、统一工作区和审计能力，为后续完整业务闭环提供稳定底座。
          </Typography.Paragraph>
        </div>
      </aside>
    </main>
  );
}
