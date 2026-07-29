"use client";

import type { ReactNode } from "react";
import { App as AntdApp, ConfigProvider } from "antd";
import { designTokens } from "@dse/config/design-tokens";
import { AuthProvider } from "../src/auth/auth-context";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: designTokens.colorPrimary,
          colorBgLayout: designTokens.colorLayoutBackground,
          colorBgContainer: designTokens.colorContainer,
          borderRadius: designTokens.borderRadius,
          fontFamily: designTokens.fontFamily,
        },
      }}
    >
      <AntdApp>
        <AuthProvider>{children}</AuthProvider>
      </AntdApp>
    </ConfigProvider>
  );
}
