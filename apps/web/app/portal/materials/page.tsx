"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, Col, Empty, Row, Space, Tag, Upload, message } from "antd";
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
  return (
    <>
      {contextHolder}
      <PortalPageTitle
        title="我的资料"
        description="上传后会生成新版本，老师审核前不会覆盖历史文件。支持 PDF、Word、JPG 和 PNG，单个文件不超过 50MB。"
      />
      {items.length ? (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col xs={24} md={12} key={item.id}>
              <Card
                title={
                  <Space>
                    {item.title}
                    {item.materialType.isCore ? <Tag color="blue">核心</Tag> : null}
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
                  <span>{item.requirement ?? "按老师要求提交"}</span>
                  {item.missingReason ? (
                    <span style={{ color: "#b45309" }}>缺失/退回说明：{item.missingReason}</span>
                  ) : null}
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
                          .then(() => messageApi.success("资料已上传，等待老师审核"))
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
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Empty description="暂无待提交资料" />
      )}
    </>
  );
}
