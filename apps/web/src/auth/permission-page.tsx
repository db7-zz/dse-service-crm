"use client";

import type { ReactNode } from "react";
import { Button } from "antd";
import type { PermissionCode } from "@dse/shared";
import { PermissionDenied } from "@dse/ui";
import { useAuth } from "./auth-context";

export function PermissionPage({
  permission,
  anyPermissions,
  children,
}: {
  permission?: PermissionCode;
  anyPermissions?: PermissionCode[];
  children: ReactNode;
}) {
  const { user } = useAuth();
  const allowed =
    Boolean(user) &&
    (!permission || user!.permissions.includes(permission)) &&
    (!anyPermissions || anyPermissions.some((candidate) => user!.permissions.includes(candidate)));
  if (!allowed) {
    return (
      <PermissionDenied
        description="当前角色没有访问此页面的权限"
        action={<Button href="/workspace">返回工作区</Button>}
      />
    );
  }
  return children;
}
