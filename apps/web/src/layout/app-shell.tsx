"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  DashboardOutlined,
  DownOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FormOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyCertificateOutlined,
  SnippetsOutlined,
  SolutionOutlined,
  TeamOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import { Avatar, Badge, Button, Dropdown, Layout, Menu } from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { LoadingState, PermissionDenied } from "@dse/ui";
import { useAuth } from "../auth/auth-context";
import { navigationFor } from "../navigation/navigation";
import { apiClient } from "../auth/api";
import styles from "./app-shell.module.css";

const { Header, Sider, Content } = Layout;

const ICONS: Record<string, ReactNode> = {
  workspace: <DashboardOutlined />,
  butlers: <BarChartOutlined />,
  supervision: <SafetyCertificateOutlined />,
  students: <UsergroupAddOutlined />,
  sop: <SnippetsOutlined />,
  "my-tasks": <FileDoneOutlined />,
  users: <TeamOutlined />,
  audit: <AuditOutlined />,
  materials: <FileSearchOutlined />,
  applications: <FormOutlined />,
  issues: <SolutionOutlined />,
  notifications: <BellOutlined />,
};

const ROLE_LABELS: Record<string, string> = {
  [RoleCode.ADMINISTRATOR]: "管理员",
  [RoleCode.ERIC_MANAGER]: "历史角色（已停用）",
  [RoleCode.BUTLER]: "管家",
  [RoleCode.PLANNER]: "规划老师",
  [RoleCode.SPECIALIST]: "专项老师",
  [RoleCode.STUDENT]: "学生",
};

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const warmedRoutes = useRef(new Set<string>());

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 720px)");
    const syncViewport = () => {
      setMobile(mediaQuery.matches);
      if (!mediaQuery.matches) {
        setMobileNavOpen(false);
      }
    };

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (!loading && user?.mustChangePassword) {
      router.replace("/change-password");
    }
  }, [loading, pathname, router, user]);

  useEffect(() => {
    if (!user?.permissions.includes(PermissionCode.NOTIFICATIONS_READ)) return;
    void apiClient
      .request<{ unreadCount: number }>("/notifications?page=1&pageSize=1")
      .then((result) => setUnreadCount(result.unreadCount))
      .catch(() => setUnreadCount(0));
  }, [pathname, user]);

  const navigation = useMemo(() => (user ? navigationFor(user) : []), [user]);

  useEffect(() => {
    if (!user || process.env.NODE_ENV !== "development") return;

    const controller = new AbortController();
    const queue = navigation.filter((item) => !warmedRoutes.current.has(item.href));

    const warmRoutes = async () => {
      const worker = async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) return;
          try {
            const response = await fetch(item.href, {
              credentials: "same-origin",
              signal: controller.signal,
            });
            if (response.ok) {
              warmedRoutes.current.add(item.href);
              router.prefetch(item.href);
            }
          } catch (exception) {
            if (exception instanceof DOMException && exception.name === "AbortError") return;
          }
        }
      };

      await Promise.all([worker(), worker(), worker(), worker()]);
    };

    const idleId = window.requestIdleCallback(() => void warmRoutes(), { timeout: 1_500 });
    return () => {
      window.cancelIdleCallback(idleId);
      controller.abort();
    };
  }, [navigation, router, user]);

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

  const selected = pathname.startsWith("/workspace/tasks/")
    ? user.permissions.includes(PermissionCode.TASK_SUPERVISION_READ)
      ? "supervision"
      : user.permissions.includes(PermissionCode.TASKS_OWN_READ)
        ? "my-tasks"
        : "workspace"
    : (navigation
        .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
        .sort((a, b) => b.href.length - a.href.length)[0]?.key ?? "workspace");
  const siderCollapsed = mobile ? false : collapsed;
  const siderWidth = siderCollapsed ? 80 : 240;
  const workspaceName = user.roles.includes(RoleCode.ADMINISTRATOR) ? "管理员端" : "内部工作台";

  return (
    <Layout className={styles.root}>
      <Sider
        className={`${styles.sider} ${mobileNavOpen ? styles.siderMobileOpen : ""}`}
        width={240}
        collapsedWidth={80}
        collapsed={siderCollapsed}
        trigger={null}
        aria-hidden={mobile && !mobileNavOpen}
        inert={mobile && !mobileNavOpen}
      >
        <div className={styles.brand}>
          <span className={styles.brandTitle}>{siderCollapsed ? "DSE" : "DSE CRM"}</span>
          {!siderCollapsed ? <span className={styles.brandSubtitle}>升学服务管理</span> : null}
          {mobile ? (
            <Button
              type="text"
              className={styles.mobileClose}
              aria-label="关闭导航"
              icon={<MenuFoldOutlined />}
              onClick={() => setMobileNavOpen(false)}
            />
          ) : null}
        </div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={[selected]}
          onClick={() => {
            if (mobile) {
              setMobileNavOpen(false);
            }
          }}
          items={navigation.map((item) => ({
            key: item.key,
            icon: ICONS[item.key],
            label: <Link href={item.href}>{item.label}</Link>,
          }))}
          style={{ background: "transparent", paddingTop: 12 }}
        />
      </Sider>
      {mobileNavOpen ? (
        <button
          type="button"
          className={styles.mobileMask}
          aria-label="关闭导航遮罩"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <Layout className={styles.contentLayout} style={{ marginLeft: mobile ? 0 : siderWidth }}>
        <Header className={styles.header}>
          <Button
            type="text"
            aria-label={
              mobile
                ? mobileNavOpen
                  ? "关闭导航"
                  : "打开导航"
                : collapsed
                  ? "展开导航"
                  : "收起导航"
            }
            icon={
              mobile ? (
                mobileNavOpen ? (
                  <MenuFoldOutlined />
                ) : (
                  <MenuUnfoldOutlined />
                )
              ) : collapsed ? (
                <MenuUnfoldOutlined />
              ) : (
                <MenuFoldOutlined />
              )
            }
            disabled={mobile && mobileNavOpen}
            onClick={() => {
              if (mobile) {
                setMobileNavOpen((value) => !value);
              } else {
                setCollapsed((value) => !value);
              }
            }}
          />
          <span style={{ flex: 1 }} />
          {user.permissions.includes(PermissionCode.NOTIFICATIONS_READ) ? (
            <Badge count={unreadCount} size="small" overflowCount={99}>
              <Button
                type="text"
                aria-label={`消息与待办，${unreadCount} 条未读`}
                icon={<BellOutlined />}
                onClick={() => router.push("/workspace/notifications")}
              />
            </Badge>
          ) : null}
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
