"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Select, Skeleton } from "antd";
import { ApiClientError } from "@dse/api-client";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import {
  createStudent,
  getResponsiblePersonOptions,
  getStudent,
  updateStudent,
} from "./student-api";
import type { ResponsiblePersonOptions, StudentFormValues } from "./student-types";
import styles from "./student-page.module.css";

export function StudentFormPage({
  mode,
  studentId,
}: {
  mode: "create" | "edit";
  studentId?: string;
}) {
  const router = useRouter();
  const { message } = App.useApp();
  const [form] = Form.useForm<StudentFormValues>();
  const [options, setOptions] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [version, setVersion] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(undefined);
      try {
        const [responsiblePeople, student] = await Promise.all([
          getResponsiblePersonOptions(),
          mode === "edit" && studentId ? getStudent(studentId) : Promise.resolve(undefined),
        ]);
        if (!active) return;
        setOptions(responsiblePeople);
        if (student) {
          setVersion(student.version);
          form.setFieldsValue({
            name: student.name,
            phone: student.phone ?? undefined,
            email: student.email ?? undefined,
          });
        }
      } catch (exception) {
        if (!active) return;
        setError(exception instanceof Error ? exception.message : "学生资料加载失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [form, mode, studentId]);

  const reloadEditStudent = async () => {
    if (!studentId) return;
    setConflict(false);
    setLoading(true);
    try {
      const student = await getStudent(studentId);
      setVersion(student.version);
      form.setFieldsValue({
        name: student.name,
        phone: student.phone ?? undefined,
        email: student.email ?? undefined,
      });
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "学生资料加载失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PermissionPage permission={PermissionCode.STUDENTS_WRITE}>
      <main className={styles.page}>
        <Link
          href={
            mode === "edit" && studentId
              ? `/workspace/students/${studentId}`
              : "/workspace/students"
          }
          className={styles.backLink}
        >
          <ArrowLeftOutlined aria-hidden />
          {mode === "edit" ? "返回学生详情" : "返回学生列表"}
        </Link>
        <section className={styles.compactHero}>
          <span className={styles.eyebrow}>Student profile</span>
          <h1 className={styles.compactTitle}>
            {mode === "create"
              ? "为新的服务关系，建立一个清晰起点。"
              : "让学生资料保持准确、简洁。"}
          </h1>
          <p className={styles.lead}>
            {mode === "create"
              ? "只需姓名即可建档。联系方式与负责人都可以稍后补充。"
              : "这里更新学生的基本联系方式；负责人请在学生详情页单独调整，以保留完整变更原因。"}
          </p>
        </section>

        <section className={styles.formSurface} aria-busy={loading || submitting}>
          <div className={styles.formIntro}>
            <h2>{mode === "create" ? "新建学生" : "编辑基本资料"}</h2>
            <p>标有“必填”的字段需要完成，其余字段可留空。保存成功后将直接进入学生详情。</p>
          </div>
          {conflict ? (
            <Alert
              className={styles.conflict}
              type="warning"
              showIcon
              title="资料已在其他位置更新"
              description="请刷新到最新版本后重新确认本次修改。"
              action={<Button onClick={() => void reloadEditStudent()}>刷新资料</Button>}
            />
          ) : null}
          {error ? (
            <Alert
              className={styles.conflict}
              type="error"
              showIcon
              title={error}
              action={<Button onClick={() => window.location.reload()}>重试</Button>}
            />
          ) : null}
          {loading ? (
            <Skeleton active paragraph={{ rows: 7 }} />
          ) : (
            <Form<StudentFormValues>
              form={form}
              layout="vertical"
              requiredMark={false}
              onFinish={async (values) => {
                setSubmitting(true);
                setConflict(false);
                setError(undefined);
                try {
                  const student =
                    mode === "create"
                      ? await createStudent(values)
                      : await updateStudent(studentId!, values, version!);
                  await message.success(mode === "create" ? "学生建档成功" : "学生资料已更新");
                  router.push(`/workspace/students/${student.id}?saved=1`);
                } catch (exception) {
                  if (exception instanceof ApiClientError && exception.status === 409) {
                    setConflict(true);
                  } else {
                    setError(exception instanceof Error ? exception.message : "保存失败，请重试");
                  }
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              <div className={styles.formGrid}>
                <Form.Item
                  className={styles.fullWidth}
                  label="学生姓名（必填）"
                  name="name"
                  rules={[
                    { required: true, whitespace: true, message: "请输入学生姓名" },
                    { max: 100, message: "姓名不能超过100个字符" },
                  ]}
                >
                  <Input size="large" placeholder="例如：黄翰" autoComplete="name" />
                </Form.Item>
                <Form.Item
                  label="联系电话（可选）"
                  name="phone"
                  rules={[
                    {
                      pattern: /^[0-9+\-()\s]{5,32}$/,
                      message: "请输入有效的联系电话",
                    },
                  ]}
                >
                  <Input size="large" placeholder="+852 6123 4567" autoComplete="tel" />
                </Form.Item>
                <Form.Item
                  label="联系邮箱（可选）"
                  name="email"
                  rules={[{ type: "email", message: "请输入有效的邮箱地址" }]}
                >
                  <Input size="large" placeholder="hon.wong@example.com" autoComplete="email" />
                </Form.Item>
                {mode === "create" ? (
                  <>
                    <Form.Item label="默认管家（可选）" name="defaultButlerId">
                      <Select
                        size="large"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="暂不分配"
                        options={options.butlers.map((person) => ({
                          value: person.id,
                          label: person.displayName,
                        }))}
                        notFoundContent="暂无可用管家"
                      />
                    </Form.Item>
                    <Form.Item label="规划老师（可选）" name="plannerId">
                      <Select
                        size="large"
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="暂不分配"
                        options={options.planners.map((person) => ({
                          value: person.id,
                          label: person.displayName,
                        }))}
                        notFoundContent="暂无可用规划老师"
                      />
                    </Form.Item>
                  </>
                ) : null}
              </div>
              <div className={styles.formFooter}>
                <Button
                  className={styles.secondaryButton}
                  onClick={() =>
                    router.push(
                      mode === "edit" && studentId
                        ? `/workspace/students/${studentId}`
                        : "/workspace/students",
                    )
                  }
                >
                  取消
                </Button>
                <Button
                  className={styles.primaryButton}
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                >
                  {submitting ? "正在保存…" : "保存并查看详情"}
                </Button>
              </div>
            </Form>
          )}
        </section>
      </main>
    </PermissionPage>
  );
}
