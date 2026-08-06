"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Col, Collapse, Empty, Row, Space, Tag, Upload, message } from "antd";
import { PortalPageTitle } from "../../../src/portal/portal-shell";
import {
  getPortalMaterials,
  uploadPortalMaterial,
  type PortalMaterial,
} from "../../../src/portal/portal-api";

export default function PortalMaterialsPage() {
  const [items, setItems] = useState<PortalMaterial[]>([]);
  const [messageApi, contextHolder] = message.useMessage();
  const refresh = useCallback(
    () => getPortalMaterials().then((result) => setItems(result.items)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const currentItems = items.filter((item) => item.materialType.collectionPhase === "CURRENT");
  const laterItems = items.filter((item) => item.materialType.collectionPhase === "LATER");

  const materialCard = (item: PortalMaterial) => (
    <Col xs={24} md={12} key={item.id}>
      <Card
        title={
          <Space>
            {item.materialType.sequenceNo}. {item.title}
            {item.materialType.isCore ? <Tag color="blue">重点</Tag> : null}
          </Space>
        }
        extra={
          <Tag
            color={
              item.status === "APPROVED"
                ? "success"
                : item.status === "PENDING_REVIEW"
                  ? "processing"
                  : "warning"
            }
          >
            {item.status}
          </Tag>
        }
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <span>{item.requirement ?? "按管家说明提交"}</span>
          {item.missingReason ? (
            <span style={{ color: "#b45309" }}>需补充：{item.missingReason}</span>
          ) : null}
          {item.materialType.inputMode === "FORM" ? (
            <Link href="/portal/profile">
              <Button type="primary">填写基本信息表</Button>
            </Link>
          ) : item.materialType.inputMode === "SECURE_REFERENCE" ? (
            <Alert
              type="warning"
              showIcon
              title="请勿在普通文件或备注中上传账号密码"
              description="到相应申请阶段后，管家会告知安全交付方式。"
            />
          ) : (
            <>
              <span style={{ color: "#69788b" }}>
                {item.currentVersion
                  ? `当前 v${item.currentVersion.versionNo} · ${item.currentVersion.fileName}`
                  : "尚未上传"}
              </span>
              {item.currentVersion?.reviewComment ? (
                <span>审核意见：{item.currentVersion.reviewComment}</span>
              ) : null}
              <Space wrap>
                <Upload
                  showUploadList={false}
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  beforeUpload={(file) => {
                    void uploadPortalMaterial(item.id, file)
                      .then(() => refresh())
                      .then(() => messageApi.success("资料已上传，等待管家审核"))
                      .catch((error: unknown) =>
                        messageApi.error(error instanceof Error ? error.message : "上传失败"),
                      );
                    return false;
                  }}
                >
                  <Button type="primary">
                    {item.currentVersion ? "上传新版本" : "选择文件上传"}
                  </Button>
                </Upload>
                {item.currentVersion ? (
                  <Button
                    href={`/api/v1/portal/me/material-versions/${item.currentVersion.id}/download`}
                  >
                    下载当前版本
                  </Button>
                ) : null}
              </Space>
            </>
          )}
        </Space>
      </Card>
    </Col>
  );
  return (
    <>
      {contextHolder}
      <PortalPageTitle
        title="我的资料"
        description="优先完成当前阶段资料；后续阶段项目已列出但无需现在准备。上传由管家检查归属、清晰度与完整性。"
      />
      <Alert
        type="info"
        showIcon
        title="资料不阻塞账号或服务使用"
        description="新资料会在需要时由平台开放提醒；如逾期、退回或有异常，管家再通过服务群协助。"
        style={{ marginBottom: 16 }}
      />
      {items.length ? (
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <div>
            <h2>当前需提交</h2>
            <Row gutter={[16, 16]}>{currentItems.map(materialCard)}</Row>
          </div>
          <Collapse
            items={[
              {
                key: "later",
                label: `后续阶段资料（${laterItems.length}项，现在无需提交）`,
                children: <Row gutter={[16, 16]}>{laterItems.map(materialCard)}</Row>,
              },
            ]}
          />
        </Space>
      ) : (
        <Empty description="暂无待提交资料" />
      )}
    </>
  );
}
