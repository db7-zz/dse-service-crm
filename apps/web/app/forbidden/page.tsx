import Link from "next/link";
import { Button, Result } from "antd";

export default function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="无权访问"
      subTitle="当前账号没有访问此页面的权限。"
      extra={
        <Link href="/workspace">
          <Button type="primary">返回工作区</Button>
        </Link>
      }
    />
  );
}
