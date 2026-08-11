"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  message,
} from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../auth/permission-page";
import { useAuth } from "../auth/auth-context";
import { PageShell } from "../layout/page-shell";
import {
  getStudentRecord,
  updateStudentRecord,
  updateStudentRisk,
  updateStudentServiceStatus,
} from "./operations-api";
import type { StudentFullRecordView } from "./operations-types";

export function StudentRecordPage({ studentId }: { studentId: string }) {
  const { user } = useAuth();
  const [record, setRecord] = useState<StudentFullRecordView | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();
  const [messageApi, contextHolder] = message.useMessage();
  const canPlan = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_PLANNING_WRITE));
  const canAdmin = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_WRITE));

  const refresh = useCallback(async () => {
    try {
      const result = await getStudentRecord(studentId);
      setRecord(result);
      form.setFieldsValue({
        englishName: result.englishName,
        school: result.school,
        grade: result.grade,
        cohortYear: result.cohortYear,
        nextMilestone: result.nextMilestone,
        scores: result.scores.map(({ subjectName, scoreType, scoreValue }) => ({
          subjectName,
          scoreType,
          scoreValue,
        })),
        targets: result.targets.map(({ institutionName, programName, targetLevel }) => ({
          institutionName,
          programName,
          targetLevel,
        })),
      });
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "学生档案加载失败");
    }
  }, [form, messageApi, studentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!record)
    return (
      <PermissionPage
        anyPermissions={[PermissionCode.STUDENTS_READ, PermissionCode.STUDENTS_OWN_READ]}
      >
        <PageShell title="学生档案">
          <Empty description="正在加载学生档案" />
        </PageShell>
      </PermissionPage>
    );

  const save = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await updateStudentRecord(studentId, {
        ...values,
        version: record.version,
        reason: "在学生完整档案页更新规划资料",
      });
      await refresh();
      messageApi.success("学生档案已保存");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const changeRisk = () => {
    let riskLevel = record.riskLevel;
    let riskNote = record.riskNote ?? "";
    Modal.confirm({
      title: "更新风险标记",
      content: (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Select
            defaultValue={riskLevel}
            style={{ width: "100%" }}
            options={[
              { value: "NORMAL", label: "正常" },
              { value: "ATTENTION", label: "需关注" },
              { value: "HIGH", label: "高风险" },
            ]}
            onChange={(value) => {
              riskLevel = value;
            }}
          />
          <Input.TextArea
            defaultValue={riskNote}
            placeholder="风险说明"
            onChange={(event) => {
              riskNote = event.target.value;
            }}
          />
        </Space>
      ),
      okText: "保存",
      onOk: async () => {
        await updateStudentRisk(studentId, { riskLevel, riskNote, version: record.version });
        await refresh();
      },
    });
  };

  const changeServiceStatus = (status: "ENABLED" | "PAUSED" | "TERMINATED") => {
    const reason = window.prompt(
      status === "PAUSED"
        ? "请输入暂停服务原因"
        : status === "TERMINATED"
          ? "请输入终止服务原因"
          : "请输入恢复服务原因",
    );
    if (!reason) return;
    void updateStudentServiceStatus(studentId, {
      status,
      unfinishedTaskAction: status === "TERMINATED" ? "CANCEL" : "KEEP",
      reason,
      version: record.version,
    })
      .then(() => refresh())
      .then(() => messageApi.success("服务状态已更新"))
      .catch((error: unknown) =>
        messageApi.error(error instanceof Error ? error.message : "更新失败"),
      );
  };

  return (
    <PermissionPage
      anyPermissions={[PermissionCode.STUDENTS_READ, PermissionCode.STUDENTS_OWN_READ]}
    >
      {contextHolder}
      <PageShell
        title={`${record.name} · 完整档案`}
        section="学生管理"
        description={`${record.studentNo} · 资料、成绩、目标、风险与服务状态`}
        extra={
          <Space>
            <Button href={`/workspace/students/${studentId}`}>返回服务进度</Button>
            {canAdmin ? <Button onClick={changeRisk}>风险标记</Button> : null}
            {canPlan ? (
              <Button type="primary" loading={saving} onClick={() => void save()}>
                保存档案
              </Button>
            ) : null}
          </Space>
        }
      >
        <Space direction="vertical" size={20} style={{ width: "100%" }}>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="已完成阶段"
                  value={record.progress?.completedStageCount ?? 0}
                  suffix="/ 8"
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="核心资料缺口" value={record.missingCoreMaterialCount} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="申请记录" value={record.applications.length} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic
                  title="风险"
                  valueRender={() => (
                    <Tag
                      color={
                        record.riskLevel === "HIGH"
                          ? "error"
                          : record.riskLevel === "ATTENTION"
                            ? "warning"
                            : "success"
                      }
                    >
                      {record.riskLevel === "HIGH"
                        ? "高风险"
                        : record.riskLevel === "ATTENTION"
                          ? "需关注"
                          : "正常"}
                    </Tag>
                  )}
                />
              </Card>
            </Col>
          </Row>
          <Descriptions
            bordered
            size="small"
            column={{ xs: 1, sm: 2, lg: 3 }}
            items={[
              {
                key: "butler",
                label: "默认管家",
                children: record.defaultButler?.displayName ?? "未分配",
              },
              {
                key: "planner",
                label: "规划老师",
                children: record.planner?.displayName ?? "未分配",
              },
              {
                key: "status",
                label: "服务状态",
                children: (
                  <Space>
                    <Tag>{record.serviceStatus}</Tag>
                    {canAdmin ? (
                      <>
                        {record.serviceStatus === "PAUSED" ? (
                          <Button size="small" onClick={() => changeServiceStatus("ENABLED")}>
                            恢复
                          </Button>
                        ) : (
                          <Button size="small" onClick={() => changeServiceStatus("PAUSED")}>
                            暂停
                          </Button>
                        )}
                        {record.serviceStatus !== "TERMINATED" ? (
                          <Button
                            danger
                            size="small"
                            onClick={() => changeServiceStatus("TERMINATED")}
                          >
                            终止
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </Space>
                ),
              },
              { key: "risk", label: "风险说明", children: record.riskNote ?? "—" },
              {
                key: "materials",
                label: "资料",
                children: (
                  <Link href={`/workspace/materials?studentId=${studentId}`}>查看资料管理</Link>
                ),
              },
              {
                key: "apps",
                label: "申请",
                children: (
                  <Link href={`/workspace/applications/students/${studentId}`}>查看申请管理</Link>
                ),
              },
            ]}
          />
          <Form form={form} layout="vertical" disabled={!canPlan}>
            <Tabs
              items={[
                {
                  key: "profile",
                  label: "学业资料",
                  children: (
                    <Row gutter={16}>
                      <Col xs={24} md={12}>
                        <Form.Item name="englishName" label="英文姓名">
                          <Input maxLength={100} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="school" label="就读学校">
                          <Input maxLength={150} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="grade" label="年级">
                          <Input maxLength={32} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="cohortYear" label="届别">
                          <InputNumber min={2020} max={2100} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        <Form.Item name="nextMilestone" label="下一里程碑">
                          <Input.TextArea rows={3} maxLength={500} />
                        </Form.Item>
                      </Col>
                    </Row>
                  ),
                },
                {
                  key: "scores",
                  label: "成绩",
                  children: (
                    <Form.List name="scores">
                      {(fields, { add, remove }) => (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          {fields.map((field) => (
                            <Card size="small" key={field.key}>
                              <Row gutter={12}>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "subjectName"]}
                                    label="科目"
                                    rules={[{ required: true }]}
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={7}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "scoreType"]}
                                    label="类别"
                                    rules={[{ required: true }]}
                                  >
                                    <Select
                                      options={[
                                        { value: "CURRENT", label: "当前成绩" },
                                        { value: "PREDICTED", label: "预测成绩" },
                                      ]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col xs={20} md={7}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "scoreValue"]}
                                    label="成绩"
                                    rules={[{ required: true }]}
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col xs={4} md={2}>
                                  <Button
                                    danger
                                    type="text"
                                    aria-label="删除成绩"
                                    icon={<MinusCircleOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          {canPlan ? (
                            <Button
                              block
                              type="dashed"
                              icon={<PlusOutlined />}
                              onClick={() => add()}
                            >
                              添加成绩
                            </Button>
                          ) : null}
                        </Space>
                      )}
                    </Form.List>
                  ),
                },
                {
                  key: "targets",
                  label: "申请目标",
                  children: (
                    <Form.List name="targets">
                      {(fields, { add, remove }) => (
                        <Space direction="vertical" style={{ width: "100%" }}>
                          {fields.map((field) => (
                            <Card size="small" key={field.key}>
                              <Row gutter={12}>
                                <Col xs={24} md={8}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "institutionName"]}
                                    label="院校"
                                    rules={[{ required: true }]}
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col xs={24} md={7}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "programName"]}
                                    label="专业"
                                  >
                                    <Input />
                                  </Form.Item>
                                </Col>
                                <Col xs={20} md={7}>
                                  <Form.Item
                                    {...field}
                                    name={[field.name, "targetLevel"]}
                                    label="目标层级"
                                    rules={[{ required: true }]}
                                  >
                                    <Select
                                      options={[
                                        { value: "ASPIRATIONAL", label: "冲刺" },
                                        { value: "MATCH", label: "匹配" },
                                        { value: "SAFE", label: "保底" },
                                        { value: "OTHER", label: "其他" },
                                      ]}
                                    />
                                  </Form.Item>
                                </Col>
                                <Col xs={4} md={2}>
                                  <Button
                                    danger
                                    type="text"
                                    aria-label="删除目标"
                                    icon={<MinusCircleOutlined />}
                                    onClick={() => remove(field.name)}
                                  />
                                </Col>
                              </Row>
                            </Card>
                          ))}
                          {canPlan ? (
                            <Button
                              block
                              type="dashed"
                              icon={<PlusOutlined />}
                              onClick={() => add()}
                            >
                              添加目标
                            </Button>
                          ) : null}
                        </Space>
                      )}
                    </Form.List>
                  ),
                },
              ]}
            />
          </Form>
        </Space>
      </PageShell>
    </PermissionPage>
  );
}
