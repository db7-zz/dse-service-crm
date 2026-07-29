"use client";

import type { ReactNode } from "react";
import {
  Alert,
  Button,
  DatePicker,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  type DrawerProps,
  type InputProps,
  type ModalProps,
  type SelectProps,
  type TableProps,
} from "antd";
import { SearchOutlined } from "@ant-design/icons";

export function DataTable<RecordType extends object>(props: TableProps<RecordType>) {
  return (
    <Table<RecordType>
      rowKey="id"
      pagination={{ pageSize: 20, showSizeChanger: true }}
      scroll={{ x: "max-content" }}
      {...props}
    />
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Space wrap size={[12, 12]} style={{ marginBottom: 16, width: "100%" }}>
      {children}
    </Space>
  );
}

export function SearchInput(props: InputProps) {
  return (
    <Input
      allowClear
      prefix={<SearchOutlined />}
      placeholder="输入关键词搜索"
      style={{ width: 240 }}
      {...props}
    />
  );
}

export const FormField = Form.Item;
export const AppDatePicker = DatePicker;

export function PersonSelect(props: SelectProps) {
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder="选择人员"
      notFoundContent="暂无可选人员"
      style={{ minWidth: 200 }}
      {...props}
    />
  );
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "success",
  DISABLED: "default",
  LOCKED: "error",
  IN_PROGRESS: "processing",
  COMPLETED: "success",
  OVERDUE: "error",
};

export function StatusTag({ status, label }: { status: string; label?: string }) {
  return <Tag color={STATUS_COLORS[status] ?? "default"}>{label ?? status}</Tag>;
}

export function confirmAction(options: {
  title: string;
  content: ReactNode;
  okText?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return Modal.confirm({
    title: options.title,
    content: options.content,
    okText: options.okText ?? "确认",
    cancelText: "取消",
    okButtonProps: { danger: options.danger },
    onOk: options.onConfirm,
  });
}

export function FormModal(
  props: ModalProps & { submitText?: string; submitting?: boolean; children: ReactNode },
) {
  const { submitText, submitting, children, ...modalProps } = props;
  return (
    <Modal
      destroyOnHidden
      okText={submitText ?? "保存"}
      cancelText="取消"
      confirmLoading={submitting}
      {...modalProps}
    >
      {children}
    </Modal>
  );
}

export function DetailDrawer(props: DrawerProps) {
  return <Drawer width={560} destroyOnHidden {...props} />;
}

export function LoadingState({ rows = 5 }: { rows?: number }) {
  return <Skeleton active paragraph={{ rows }} />;
}

export function EmptyState({
  title = "暂无数据",
  description,
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty description={description ?? title}>
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </Empty>
  );
}

export function ErrorState({
  message = "加载失败，请稍后重试",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert
      type="error"
      showIcon
      title={message}
      action={onRetry ? <Button onClick={onRetry}>重试</Button> : undefined}
    />
  );
}

export function PermissionDenied() {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="你没有访问此页面的权限" />;
}
