"use client";

import { useEffect, useState } from "react";
import { Card, Empty, Progress, Space, Steps, Tag } from "antd";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import { getPortalProgress } from "../../../src/portal/portal-api";

type ProgressData = Awaited<ReturnType<typeof getPortalProgress>>;

export default function PortalProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  useEffect(() => {
    void getPortalProgress().then(setData);
  }, []);
  if (!data) return null;
  return (
    <>
      <PortalPageTitle
        title="服务进度"
        description="阶段由服务任务完成情况自动推进；只展示与你相关的公开任务。"
      />
      {data.progress ? (
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Card>
            <Progress percent={Math.round((data.progress.completedStageCount / 8) * 100)} />
            <div>已完成 {data.progress.completedStageCount} / 8 个阶段</div>
            {data.progress.nextMilestone ? (
              <div style={{ color: "#69788b", marginTop: 8 }}>
                下一里程碑：{data.progress.nextMilestone}
              </div>
            ) : null}
          </Card>
          <Steps
            direction="vertical"
            current={data.stages.findIndex((stage) => stage.status === "IN_PROGRESS")}
            items={data.stages.map((stage) => ({
              title: `${stage.sequenceNo}. ${stage.name}`,
              status:
                stage.status === "COMPLETED"
                  ? "finish"
                  : stage.status === "IN_PROGRESS"
                    ? "process"
                    : "wait",
              description: stage.tasks.length ? (
                <Space direction="vertical" size={4}>
                  {stage.tasks.map((task) => (
                    <span key={task.id}>
                      <Tag>{task.status}</Tag>
                      {task.title} · {new Date(task.dueAt).toLocaleDateString("zh-CN")}
                    </span>
                  ))}
                </Space>
              ) : (
                "该阶段暂无需要你查看的任务"
              ),
            }))}
          />
        </Space>
      ) : (
        <Empty description="服务尚未启用" />
      )}
    </>
  );
}
