"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AuditOutlined,
  DashboardOutlined,
  DownOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Dropdown, Layout, Menu } from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { LoadingState, PermissionDenied } from "@dse/ui";
import { useAuth } from "../auth/auth-context";
import { navigationFor } from "../navigation/navigation";
import styles from "./app-shell.module.css";

const { Header, Sider, Content } = Layout;

const ICONS: Record<string, ReactNode> = {
  workspace: <DashboardOutlined />,
  supervision: <SafetyCertificateOutlined />,
  users: <TeamOutlined />,
  audit: <AuditOutlined />,
};

const ROLE_LABELS: Record<string, string> = {
  [RoleCode.ADMINISTRATOR]: "管理员",
  [RoleCode.ERIC_MANAGER]: "业务负责人",
  [RoleCode.BUTLER]: "管家",
  [RoleCode.PLANNER]: "规划老师",
  [RoleCode.SPECIALIST]: "专项老师",
  [RoleCode.STUDENT]: "学生",
};

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, pathname, router, user]);

  const navigation = useMemo(() => (user ? navigationFor(user) : []), [user]);
  if (loading || !user) {
    return (
      <div style={{ maxWidth: 720, margin: "15vh auto", padding: 24 }}>
        <LoadingState rows={6} />
      </div>
    );
  }
  if (!user.permissions.includes(PermissionCode.WORKSPACE_ACCESS)) {
    return (
      <main style={{ maxWidth: 720, margin: "15vh auto", padding: 24 }}>
        <PermissionDenied />
      </main>
    );
  }

  const selected =
    navigation
      .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]?.key ?? "workspace";
  const siderWidth = collapsed ? 80 : 240;
  const workspaceName = user.roles.includes(RoleCode.ADMINISTRATOR)
    ? "管理员端"
    : user.roles.includes(RoleCode.ERIC_MANAGER)
      ? "监督管理端"
      : "内部工作台";

  return (
    <Layout className={styles.root}>
      <Sider
        className={styles.sider}
        width={240}
        collapsedWidth={80}
        collapsed={collapsed}
        trigger={null}
      >
        <div className={styles.brand}>
          <span className={styles.brandTitle}>{collapsed ? "DSE" : "DSE CRM"}</span>
          {!collapsed ? <span className={styles.brandSubtitle}>升学服务管理</span> : null}
        </div>
        <Menu
          mode="inline"
          theme="dark"
          selectedKeys={[selected]}
          items={navigation.map((item) => ({
            key: item.key,
            icon: ICONS[item.key],
            label: <Link href={item.href}>{item.label}</Link>,
          }))}
          style={{ background: "transparent", paddingTop: 12 }}
        />
      </Sider>
      <Layout className={styles.contentLayout} style={{ marginLeft: siderWidth }}>
        <Header className={styles.header}>
          <Button
            type="text"
            aria-label={collapsed ? "展开导航" : "收起导航"}
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((value) => !value)}
          />
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: "退出登录",
                  onClick: async () => {
                    await logout();
                    router.replace("/login");
                  },
                },
              ],
            }}
          >
            <button
              type="button"
              className={styles.userMenu}
              aria-label={`打开${user.displayName}的账户菜单`}
            >
              <Avatar size={36} className={styles.userAvatar}>
                {user.displayName.slice(0, 1)}
              </Avatar>
              <span className={styles.userText}>
                <span className={styles.userName}>{user.displayName}</span>
                <span className={styles.userMeta}>
                  {workspaceName} ·{" "}
                  {user.roles.map((role) => ROLE_LABELS[role] ?? role).join(" / ")}
                </span>
              </span>
              <DownOutlined className={styles.userChevron} aria-hidden />
            </button>
          </Dropdown>
        </Header>
        <Content className={styles.content}>
          <div className={styles.contentCard}>{children}</div>
        </Content>
      </Layout>
    </Layout>
  );
}
