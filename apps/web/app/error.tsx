"use client";

import { Button, Result } from "antd";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Result
      status="500"
      title="系统暂时无法显示此页面"
      subTitle="请稍后重试。如果问题持续出现，请向管理员提供发生时间。"
      extra={
        <Button type="primary" onClick={reset}>
          重新加载
        </Button>
      }
    />
  );
}
