"use client";

import { DownloadOutlined, FileTextOutlined } from "@ant-design/icons";
import { Button, Image, Modal, Result } from "antd";
import styles from "./file-preview-modal.module.css";

export interface PreviewFile {
  fileName: string;
  mimeType: string;
  downloadUrl: string;
  previewUrl?: string | null;
}

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: PreviewFile | null;
  onClose: () => void;
}) {
  const previewable = Boolean(file?.previewUrl);
  return (
    <Modal
      open={Boolean(file)}
      title={file?.fileName ?? "查看文件"}
      width="min(1040px, calc(100vw - 32px))"
      footer={
        file ? (
          <Button type="primary" icon={<DownloadOutlined />} href={file.downloadUrl}>
            下载原文件
          </Button>
        ) : null
      }
      destroyOnHidden
      onCancel={onClose}
    >
      {file?.previewUrl && file.mimeType.startsWith("image/") ? (
        <div className={styles.imageStage}>
          <Image src={file.previewUrl} alt={file.fileName} preview={false} />
        </div>
      ) : null}
      {file?.previewUrl && file.mimeType === "application/pdf" ? (
        <iframe className={styles.pdfFrame} src={file.previewUrl} title={file.fileName} />
      ) : null}
      {file && !previewable ? (
        <Result
          icon={<FileTextOutlined />}
          title="此格式暂不支持在线预览"
          subTitle="Word 文档会保留原格式，请下载后查看。"
          extra={
            <Button type="primary" icon={<DownloadOutlined />} href={file.downloadUrl}>
              下载文件
            </Button>
          }
        />
      ) : null}
    </Modal>
  );
}
