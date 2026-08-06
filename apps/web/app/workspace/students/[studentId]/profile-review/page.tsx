"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeftOutlined, CheckOutlined } from "@ant-design/icons";
import { Alert, App, Button, Card, Skeleton, Table, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../../../src/auth/permission-page";
import {
  confirmStudentProfileSubmission,
  getStudentProfileSubmission,
  type StudentProfileSubmissionView,
} from "../../../../../src/students/student-api";
import styles from "../../../../../src/students/student-page.module.css";

const LABELS: Record<string, string> = {
  studentName: "学生姓名",
  cohortYear: "DSE 届别",
  grade: "当前年级",
  school: "就读学校",
  studentPhone: "学生电话",
  studentWechat: "学生微信",
  parentName: "家长姓名",
  parentRelationship: "与学生关系",
  parentPhone: "家长电话",
  parentWechat: "家长微信",
  identityCategory: "身份/申请路径",
  examCandidateType: "考生类别",
  dseSubjects: "DSE 科目",
  scoreSummary: "当前成绩概况",
  targetDirection: "目标方向",
};

function show(value: unknown) {
  if (Array.isArray(value)) return value.join("、");
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export default function ProfileReviewPage() {
  const { message, modal } = App.useApp();
  const { studentId } = useParams<{ studentId: string }>();
  const [data, setData] = useState<StudentProfileSubmissionView>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const load = useCallback(
    () =>
      getStudentProfileSubmission(studentId)
        .then(setData)
        .finally(() => setLoading(false)),
    [studentId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const rows = data?.submission
    ? Object.keys(LABELS).map((key) => ({
        key,
        label: LABELS[key],
        official: data.official[key],
        submitted: data.submission!.data[key],
        changed:
          JSON.stringify(data.official[key] ?? null) !==
          JSON.stringify(data.submission!.data[key] ?? null),
      }))
    : [];
  return (
    <PermissionPage permission={PermissionCode.STUDENTS_OWN_WRITE}>
      <main className={styles.page}>
        <Link href={`/workspace/students/${studentId}`} className={styles.backLink}>
          <ArrowLeftOutlined />
          返回学生详情
        </Link>
        <section className={styles.compactHero}>
          <span className={styles.eyebrow}>Profile review</span>
          <h1 className={styles.compactTitle}>确认学生建档资料</h1>
          <p className={styles.lead}>
            只核对学生/家长提交与当前档案的差异。确认后写入正式档案，并自动通知管理员分配规划老师。
          </p>
        </section>
        {loading ? (
          <Skeleton active />
        ) : !data?.submission ? (
          <Alert
            type="info"
            showIcon
            title="学生尚未提交基本信息表"
            description="账号和其他资料上传不受影响，无需在微信群重复收集同一份表。"
          />
        ) : (
          <Card
            title={
              <>
                提交版本 v{data.submission.version}{" "}
                <Tag color={data.profileStatus === "PENDING_REVIEW" ? "processing" : "success"}>
                  {data.profileStatus === "PENDING_REVIEW" ? "待确认" : "已确认"}
                </Tag>
              </>
            }
          >
            <Table
              pagination={false}
              rowKey="key"
              dataSource={rows}
              rowClassName={(row) => (row.changed ? "profile-diff-row" : "")}
              columns={[
                { title: "字段", dataIndex: "label", width: 160 },
                { title: "当前正式档案", dataIndex: "official", render: show },
                {
                  title: "学生本次提交",
                  dataIndex: "submitted",
                  render: (value, row) => (
                    <span
                      style={{
                        fontWeight: row.changed ? 600 : 400,
                        color: row.changed ? "#9a3412" : undefined,
                      }}
                    >
                      {show(value)}
                    </span>
                  ),
                },
                {
                  title: "差异",
                  dataIndex: "changed",
                  width: 90,
                  render: (changed) =>
                    changed ? <Tag color="orange">有变化</Tag> : <Tag>相同</Tag>,
                },
              ]}
            />
            {data.profileStatus === "PENDING_REVIEW" ? (
              <Button
                type="primary"
                size="large"
                icon={<CheckOutlined />}
                loading={submitting}
                style={{ marginTop: 20 }}
                onClick={() =>
                  modal.confirm({
                    title: "确认写入正式档案？",
                    content: "确认后资料将写入正式档案；规划老师待办已在账号开通时自动生成。",
                    okText: "确认档案完整",
                    onOk: async () => {
                      setSubmitting(true);
                      try {
                        await confirmStudentProfileSubmission(studentId, data.submission!.version);
                        await message.success("档案已确认，管理员已收到规划老师分配提醒");
                        await load();
                      } finally {
                        setSubmitting(false);
                      }
                    },
                  })
                }
              >
                确认档案完整
              </Button>
            ) : null}
          </Card>
        )}
      </main>
    </PermissionPage>
  );
}
