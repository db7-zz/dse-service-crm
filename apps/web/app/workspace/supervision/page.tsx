"use client";

import { PermissionCode } from "@dse/shared";
import { Card, Empty, Tag, Typography } from "antd";
import { PermissionPage } from "../../../src/auth/permission-page";
import { PageShell } from "../../../src/layout/page-shell";

export default function SupervisionPage() {
  return (
    <PermissionPage permission={PermissionCode.TASK_SUPERVISION_READ}>
      <PageShell
        title="监督管理看板"
        description="管理员统一监督任务进度、逾期风险和待分配事项。业务数据将在后续 S1 Issue 接入。"
      >
        <Card>
          <Empty
            description={
              <div>
                <Typography.Paragraph>阶段0暂无业务统计数据</Typography.Paragraph>
                <Tag color="blue">已完成权限与布局占位</Tag>
              </div>
            }
          />
        </Card>
      </PageShell>
    </PermissionPage>
  );
}
