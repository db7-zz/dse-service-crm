"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Empty, Space, Table, Typography, message } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { PageShell } from "../layout/page-shell";
import {
  ApplicationFiltersBar,
  ApplicationStatusTag,
  AttentionBadge,
} from "./application-components";
import { formatDateTime } from "./application-meta";
import { getAttentionApplications, type ApplicationDashboardFilters } from "./operations-api";
import type { ApplicationAttentionPageView } from "./operations-types";

export function AttentionApplicationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<ApplicationDashboardFilters>(() =>
    filtersFromSearch(searchParams),
  );
  const [data, setData] = useState<ApplicationAttentionPageView>();
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getAttentionApplications(filters));
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "需关注申请加载失败");
    } finally {
      setLoading(false);
    }
  }, [filters, messageApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const query = filterQuery(filters).toString();
    router.replace(`/workspace/applications/attention${query ? `?${query}` : ""}`, {
      scroll: false,
    });
  }, [filters, router]);

  return (
    <PermissionPage permission={PermissionCode.APPLICATIONS_READ}>
      {contextHolder}
      <PageShell
        title="需关注申请"
        breadcrumbs={[{ title: "申请管理", href: "/workspace/applications" }]}
        description="按风险优先连续处理逾期、临期、缺少截止时间及关键行动节点。"
      >
        <Space orientation="vertical" size={16} style={{ width: "100%" }}>
          <ApplicationFiltersBar
            filters={filters}
            owners={data?.owners ?? []}
            showRisk
            onChange={setFilters}
          />
          <Table
            rowKey="id"
            loading={loading}
            dataSource={data?.items ?? []}
            pagination={{
              current: data?.page ?? filters.page ?? 1,
              pageSize: data?.pageSize ?? filters.pageSize ?? 20,
              total: data?.total ?? 0,
              showSizeChanger: false,
            }}
            locale={{ emptyText: <Empty description="当前筛选下没有需关注申请" /> }}
            scroll={{ x: 1020 }}
            onChange={(pagination) =>
              setFilters((current) => ({
                ...current,
                page: pagination.current ?? 1,
                pageSize: pagination.pageSize ?? 20,
              }))
            }
            onRow={(record) => ({
              onClick: () =>
                router.push(
                  `/workspace/applications/students/${record.student.id}?applicationId=${record.id}`,
                ),
              style: { cursor: "pointer" },
            })}
            columns={[
              {
                title: "风险 / 行动",
                width: 180,
                render: (_value, item) => <AttentionBadge attention={item.attention} />,
              },
              {
                title: "学生",
                width: 150,
                render: (_value, item) => (
                  <Space orientation="vertical" size={0}>
                    <strong>{item.student.name}</strong>
                    <Typography.Text type="secondary">{item.student.studentNo}</Typography.Text>
                  </Space>
                ),
              },
              {
                title: "院校 / 专业",
                width: 280,
                render: (_value, item) => (
                  <Space orientation="vertical" size={0}>
                    <strong>{item.institutionName}</strong>
                    <Typography.Text type="secondary">
                      {item.programName ?? "未填写专业"}
                    </Typography.Text>
                  </Space>
                ),
              },
              {
                title: "精确状态",
                dataIndex: "status",
                width: 120,
                render: (status: string) => <ApplicationStatusTag status={status} />,
              },
              {
                title: "截止时间",
                width: 180,
                render: (_value, item) => formatDateTime(item.attention.deadlineAt),
              },
              {
                title: "负责人",
                width: 130,
                render: (_value, item) => item.owner?.displayName ?? "未分配",
              },
            ]}
          />
        </Space>
      </PageShell>
    </PermissionPage>
  );
}

function filtersFromSearch(searchParams: URLSearchParams): ApplicationDashboardFilters {
  const channel = searchParams.get("channel");
  return {
    page: Number(searchParams.get("page") ?? 1),
    pageSize: 20,
    search: searchParams.get("search") ?? undefined,
    ownerId: searchParams.get("ownerId") ?? undefined,
    channel: channel === "HK_DIRECT" || channel === "JUPAS" ? channel : undefined,
    stage: (searchParams.get("stage") as ApplicationDashboardFilters["stage"]) ?? undefined,
    risk: (searchParams.get("risk") as ApplicationDashboardFilters["risk"]) ?? undefined,
  };
}

function filterQuery(filters: ApplicationDashboardFilters) {
  const query = new URLSearchParams();
  if ((filters.page ?? 1) > 1) query.set("page", String(filters.page));
  if (filters.search) query.set("search", filters.search);
  if (filters.ownerId) query.set("ownerId", filters.ownerId);
  if (filters.channel) query.set("channel", filters.channel);
  if (filters.stage) query.set("stage", filters.stage);
  if (filters.risk) query.set("risk", filters.risk);
  return query;
}
