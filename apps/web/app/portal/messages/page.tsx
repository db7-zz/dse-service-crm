"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Empty, List, Space, Tag } from "antd";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../../../src/operations/operations-api";
import type { NotificationView } from "../../../src/operations/operations-types";

export default function PortalMessagesPage() {
  const [items, setItems] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const refresh = useCallback(
    () =>
      listNotifications(false).then((result) => {
        setItems(result.items);
        setUnreadCount(result.unreadCount);
      }),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <>
      <PortalPageTitle
        title="消息"
        description={`任务、资料和申请的最新提醒；${unreadCount} 条未读。`}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <Button
          disabled={!unreadCount}
          onClick={() => void markAllNotificationsRead().then(refresh)}
        >
          全部已读
        </Button>
      </div>
      <List
        dataSource={items}
        locale={{ emptyText: <Empty description="暂无消息" /> }}
        renderItem={(item) => (
          <List.Item
            onClick={() => {
              if (!item.readAt) void markNotificationRead(item.id).then(refresh);
            }}
            style={{
              padding: 18,
              background: item.readAt ? "#fff" : "#edf6ff",
              cursor: "pointer",
              borderRadius: 10,
              marginBottom: 8,
            }}
            extra={
              <Tag color={item.readAt ? "default" : "blue"}>{item.readAt ? "已读" : "未读"}</Tag>
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  <strong>{item.title}</strong>
                  <small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small>
                </Space>
              }
              description={item.content}
            />
          </List.Item>
        )}
      />
    </>
  );
}
