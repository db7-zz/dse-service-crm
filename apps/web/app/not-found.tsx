import Link from "next/link";
import { Button, Result } from "antd";

export default function NotFoundPage() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查地址，或返回工作区继续操作。"
      extra={
        <Link href="/workspace">
          <Button type="primary">返回工作区</Button>
        </Link>
      }
    />
  );
}
