"use client";

import type { ReactNode } from "react";
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
    return <PermissionDenied />;
  }
  return children;
}
