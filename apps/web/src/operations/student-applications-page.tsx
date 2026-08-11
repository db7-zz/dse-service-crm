"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Space, Spin, Tag, Typography, message } from "antd";
import { PermissionCode, RoleCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import { getStudent } from "../students/student-api";
import type { StudentRecord } from "../students/student-types";
import {
  ApplicationDetailDrawer,
  ApplicationsTable,
  CreateApplicationModal,
} from "./application-components";
import { STAGE_META, STAGE_ORDER } from "./application-meta";
import { getApplicationOwnerOptions, listApplications } from "./operations-api";
import type { ApplicationStageCode, ApplicationView, PersonRef } from "./operations-types";

export function StudentApplicationsPage() {
  const params = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const studentId = params.studentId;
  const [student, setStudent] = useState<StudentRecord>();
  const [items, setItems] = useState<ApplicationView[]>([]);
  const [selected, setSelected] = useState<ApplicationView | null>(null);
  const [ownerOptions, setOwnerOptions] = useState<PersonRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();
  const canWrite = Boolean(user?.permissions.includes(PermissionCode.APPLICATIONS_WRITE));
  const isAdministrator = Boolean(user?.roles.includes(RoleCode.ADMINISTRATOR));
  const isButler = Boolean(
    user?.roles.includes(RoleCode.BUTLER) && !user.roles.includes(RoleCode.ADMINISTRATOR),
  );
  const mine = !user?.permissions.includes(PermissionCode.STUDENTS_READ);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [studentResult, applicationResult] = await Promise.all([
        getStudent(studentId, mine),
        listApplications({ studentId, pageSize: 100 }),
      ]);
      setStudent(studentResult);
      setItems(applicationResult.items);
      const requestedId = searchParams.get("applicationId");
      setSelected((current) => {
        const targetId = current?.id ?? requestedId;
        return targetId
          ? (applicationResult.items.find((application) => application.id === targetId) ?? null)
          : null;
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "学生申请加载失败");
    } finally {
      setLoading(false);
    }
  }, [messageApi, mine, searchParams, studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isAdministrator) return;
    void getApplicationOwnerOptions()
      .then(setOwnerOptions)
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "负责人列表加载失败"),
      );
  }, [isAdministrator, messageApi]);

  const stageCounts = STAGE_ORDER.map((stage) => ({
    stage,
    count: items.filter((application) => viewStage(application.status) === stage).length,
  })).filter((item) => item.count > 0);

  return (
    <PermissionPage permission={PermissionCode.APPLICATIONS_READ}>
      {contextHolder}
      <PageShell
        title={student?.name ?? "学生申请"}
        breadcrumbs={[
          { title: isButler ? "我的申请工作台" : "申请管理", href: "/workspace/applications" },
        ]}
        description={
          student
            ? `${student.studentNo} · 集中查看该学生每份申请的精确状态、关键截止和节点待办。`
            : "正在加载学生申请信息。"
        }
        extra={
          canWrite && student ? (
            <Button type="primary" onClick={() => setCreateOpen(true)}>
              新增申请
            </Button>
          ) : null
        }
      >
        {loading && !student ? (
          <div style={{ display: "grid", placeItems: "center", minHeight: 320 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small">
              <Space wrap>
                <Typography.Text strong>共 {items.length} 份申请</Typography.Text>
                {stageCounts.map(({ stage, count }) => (
                  <Tag color={STAGE_META[stage].color} key={stage}>
                    {STAGE_META[stage].label} {count}
                  </Tag>
                ))}
              </Space>
            </Card>
            <ApplicationsTable
              items={items}
              loading={loading}
              onSelect={(application) => {
                setSelected(application);
                router.replace(
                  `/workspace/applications/students/${studentId}?applicationId=${application.id}`,
                  { scroll: false },
                );
              }}
            />
          </Space>
        )}
      </PageShell>
      <ApplicationDetailDrawer
        application={selected}
        canWrite={canWrite}
        isAdministrator={isAdministrator}
        ownerOptions={ownerOptions}
        onClose={() => {
          setSelected(null);
          router.replace(`/workspace/applications/students/${studentId}`, { scroll: false });
        }}
        onRefresh={refresh}
      />
      <CreateApplicationModal
        open={createOpen}
        students={student ? [student] : []}
        lockedStudentId={studentId}
        onClose={() => setCreateOpen(false)}
        onCreated={refresh}
      />
    </PermissionPage>
  );
}

function viewStage(status: string): ApplicationStageCode {
  if (["PLANNING", "CONFIRMED", "MATERIAL_PREPARATION"].includes(status)) return "PREPARING";
  if (["PENDING_SUBMISSION", "SUBMISSION_PENDING_EVIDENCE"].includes(status)) {
    return "PENDING_SUBMISSION";
  }
  if (["SUBMITTED", "WAITING_RESULT", "WAITLISTED"].includes(status)) return "SUBMITTED";
  if (["SUPPLEMENT", "INTERVIEW"].includes(status)) return "ACTION_REQUIRED";
  if (["OFFER", "ENROLLED"].includes(status)) return "ADMITTED";
  return "CLOSED";
}
