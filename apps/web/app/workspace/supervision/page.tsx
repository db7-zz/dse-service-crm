"use client";

import { PermissionCode } from "@dse/shared";
import { Card, Empty, Tag, Typography } from "antd";
import { PermissionPage } from "../../../src/auth/permission-page";
import { PageShell } from "../../../src/layout/page-shell";

export default function SupervisionPage() {
  return (
    <PermissionPage permission={PermissionCode.SUPERVISION_ACCESS}>
      <PageShell
        title="监督管理看板"
        description="业务负责人使用的监督管理端。任务与学生风险数据将在阶段1和阶段2接入。"
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
