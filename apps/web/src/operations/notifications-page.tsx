"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Empty, List, Space, Switch, Tag, Typography, message } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { PageShell } from "../layout/page-shell";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./operations-api";
import type { NotificationView } from "./operations-types";

export function NotificationsPage() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const router = useRouter();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listNotifications(unreadOnly);
      setItems(result.items);
      setUnreadCount(result.unreadCount);
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "消息加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, unreadOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <PermissionPage permission={PermissionCode.NOTIFICATIONS_READ}>
      {contextHolder}
      <PageShell
        title="消息与待办"
        description={`集中查看任务、资料、申请和问题协同提醒；当前 ${unreadCount} 条未读。`}
        extra={
          <Space>
            <span>只看未读</span>
            <Switch checked={unreadOnly} onChange={setUnreadOnly} />
            <Button
              disabled={unreadCount === 0}
              onClick={() => void markAllNotificationsRead().then(() => refresh())}
            >
              全部已读
            </Button>
          </Space>
        }
      >
        <List
          loading={loading}
          dataSource={items}
          locale={{ emptyText: <Empty description={unreadOnly ? "没有未读消息" : "暂无消息"} /> }}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: "18px 12px",
                background: item.readAt ? undefined : "#f0f7ff",
                cursor: item.actionUrl ? "pointer" : undefined,
              }}
              onClick={() => {
                const open = () => (item.actionUrl ? router.push(item.actionUrl) : undefined);
                if (item.readAt) return open();
                void markNotificationRead(item.id).then(() => {
                  open();
                  return refresh();
                });
              }}
              actions={[
                item.readAt ? (
                  <Tag key="read">已读</Tag>
                ) : (
                  <Tag color="blue" key="unread">
                    未读
                  </Tag>
                ),
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Typography.Text strong={!item.readAt}>{item.title}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(item.createdAt).toLocaleString("zh-CN")}
                    </Typography.Text>
                  </Space>
                }
                description={item.content}
              />
            </List.Item>
          )}
        />
      </PageShell>
    </PermissionPage>
  );
}
