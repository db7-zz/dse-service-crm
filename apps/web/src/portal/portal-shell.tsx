"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button, Skeleton } from "antd";
import { PermissionCode } from "@dse/shared";
import { useAuth } from "../auth/auth-context";
import styles from "./portal-shell.module.css";

const NAV = [
  ["/portal", "首页"],
  ["/portal/profile", "基本信息"],
  ["/portal/materials", "我的资料"],
  ["/portal/progress", "服务进度"],
  ["/portal/applications", "申请动态"],
  ["/portal/messages", "消息"],
] as const;

export function PortalShell({ children }: { children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (!loading && user && !user.permissions.includes(PermissionCode.PORTAL_ACCESS)) {
      router.replace("/workspace");
    }
  }, [loading, pathname, router, user]);
  if (loading || !user)
    return (
      <main className={styles.main}>
        <Skeleton active />
      </main>
    );
  if (!user.permissions.includes(PermissionCode.PORTAL_ACCESS)) {
    return null;
  }
  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <Link href="/portal" className={styles.brand}>
          DSE 升学服务
        </Link>
        <nav className={styles.nav}>
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={pathname === href ? styles.active : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <span className={styles.user}>{user.displayName}</span>
        <Button size="small" onClick={() => void logout().then(() => router.replace("/login"))}>
          退出
        </Button>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}

export function PortalPageTitle({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      {description ? <p className={styles.subtitle}>{description}</p> : null}
    </>
  );
}
