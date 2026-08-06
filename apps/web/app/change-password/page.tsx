"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { RoleCode } from "@dse/shared";
import { apiClient } from "../../src/auth/api";
import { useAuth } from "../../src/auth/auth-context";
import { defaultRouteFor } from "../../src/navigation/navigation";
import styles from "../login/login.module.css";

export default function ChangePasswordPage() {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const { user, loading, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    } else if (!loading && user && !user.mustChangePassword) {
      router.replace(defaultRouteFor(user));
    }
  }, [loading, router, user]);

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.form}>
          <Space orientation="vertical" size={8} style={{ marginBottom: 32 }}>
            <Typography.Text type="secondary">首次登录安全设置</Typography.Text>
            <Typography.Title level={1} style={{ margin: 0 }}>
              设置你的正式密码
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              临时密码只能用于首次登录。完成修改后才可进入服务平台。
            </Typography.Paragraph>
          </Space>
          {error ? (
            <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />
          ) : null}
          <Form
            layout="vertical"
            size="large"
            onFinish={async (values: {
              currentPassword: string;
              newPassword: string;
              confirmation: string;
            }) => {
              setSubmitting(true);
              setError(undefined);
              try {
                await apiClient.request("/auth/change-password", {
                  method: "POST",
                  body: JSON.stringify({
                    currentPassword: values.currentPassword,
                    newPassword: values.newPassword,
                  }),
                });
                await refresh();
                window.location.assign(
                  user?.roles.includes(RoleCode.STUDENT) ? "/portal" : "/workspace",
                );
              } catch (exception) {
                setError(exception instanceof Error ? exception.message : "密码修改失败，请重试");
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <Form.Item
              name="currentPassword"
              label="当前临时密码"
              rules={[{ required: true, message: "请输入当前临时密码" }]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 8, message: "新密码不少于8位" },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirmation"
              label="再次输入新密码"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    return !value || value === getFieldValue("newPassword")
                      ? Promise.resolve()
                      : Promise.reject(new Error("两次输入的新密码不一致"));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="new-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              保存并进入平台
            </Button>
          </Form>
        </div>
      </section>
      <aside className={styles.visual}>
        <div className={styles.visualContent}>
          <Typography.Title style={{ color: "#fff", fontSize: 42 }}>
            从一次临时登录，开始安全的服务协作
          </Typography.Title>
          <Typography.Paragraph style={{ color: "rgb(255 255 255 / 76%)", fontSize: 17 }}>
            正式密码仅由你本人掌握，管理员无法查看。
          </Typography.Paragraph>
        </div>
      </aside>
    </main>
  );
}
