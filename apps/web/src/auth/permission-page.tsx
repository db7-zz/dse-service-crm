"use client";

import type { ReactNode } from "react";
import { Button } from "antd";
import type { PermissionCode } from "@dse/shared";
import { PermissionDenied } from "@dse/ui";
import { useAuth } from "./auth-context";

export function PermissionPage({
  permission,
  children,
}: {
  permission: PermissionCode;
  children: ReactNode;
}) {
  const { user } = useAuth();
  if (!user?.permissions.includes(permission)) {
    return (
      <PermissionDenied
        description="当前角色没有访问此页面的权限"
        action={<Button href="/workspace">返回工作区</Button>}
      />
    );
  }
  return children;
}
