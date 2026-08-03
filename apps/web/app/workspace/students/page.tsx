"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Pagination, Select, Skeleton, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import { useAuth } from "../../../src/auth/auth-context";
import { getResponsiblePersonOptions, listStudents } from "../../../src/students/student-api";
import type {
  ResponsiblePersonOptions,
  StudentPageData,
  StudentPerson,
} from "../../../src/students/student-types";
import styles from "../../../src/students/student-page.module.css";

interface StudentListInput {
  page: number;
  pageSize: number;
  search?: string;
  serviceStatus?: string;
  defaultButlerId?: string;
  plannerId?: string;
  currentStageCode?: string;
  hasCurrentBlockers?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function Person({ person }: { person: StudentPerson | null }) {
  if (!person) {
    return <span className={styles.unassigned}>待分配</span>;
  }
  return (
    <span className={styles.person}>
      <span className={styles.avatar} aria-hidden>
        {person.displayName.slice(0, 1)}
      </span>
      {person.displayName}
    </span>
  );
}

export default function StudentsPage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const administratorView = Boolean(user?.permissions.includes(PermissionCode.STUDENTS_READ));
  const [initialInput] = useState<StudentListInput>(() => ({
    page: positiveInteger(searchParams.get("page"), 1),
    pageSize: Math.min(100, positiveInteger(searchParams.get("pageSize"), 20)),
    search: searchParams.get("search") ?? undefined,
    serviceStatus: searchParams.get("serviceStatus") ?? undefined,
    defaultButlerId: searchParams.get("defaultButlerId") ?? undefined,
    plannerId: searchParams.get("plannerId") ?? undefined,
    currentStageCode: searchParams.get("currentStageCode") ?? undefined,
    hasCurrentBlockers:
      searchParams.get("hasCurrentBlockers") === null
        ? undefined
        : searchParams.get("hasCurrentBlockers") === "true",
    sortBy: searchParams.get("sortBy") ?? undefined,
    sortOrder: "desc",
  }));
  const [data, setData] = useState<StudentPageData>({
    items: [],
    page: initialInput.page,
    pageSize: initialInput.pageSize,
    total: 0,
  });
  const [options, setOptions] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [search, setSearch] = useState(initialInput.search ?? "");
  const [serviceStatus, setServiceStatus] = useState<string | undefined>(
    initialInput.serviceStatus,
  );
  const [defaultButlerId, setDefaultButlerId] = useState<string | undefined>(
    initialInput.defaultButlerId,
  );
  const [plannerId, setPlannerId] = useState<string | undefined>(initialInput.plannerId);
  const [currentStageCode, setCurrentStageCode] = useState<string | undefined>(
    initialInput.currentStageCode,
  );
  const [hasCurrentBlockers, setHasCurrentBlockers] = useState<boolean | undefined>(
    initialInput.hasCurrentBlockers,
  );
  const [sortBy, setSortBy] = useState<string | undefined>(initialInput.sortBy);
  const [activeInput, setActiveInput] = useState(initialInput);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (input: StudentListInput) => {
      setLoading(true);
      setError(undefined);
      setActiveInput(input);
      try {
        setData(await listStudents({ ...input, mine: !administratorView }));
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "学生列表加载失败");
      } finally {
        setLoading(false);
      }
    },
    [administratorView],
  );

  const applyFilters = useCallback(
    (page = 1, pageSize = data.pageSize) =>
      load({
        page,
        pageSize,
        search,
        serviceStatus,
        defaultButlerId,
        plannerId,
        currentStageCode,
        hasCurrentBlockers,
        sortBy,
        sortOrder: "desc",
      }),
    [
      currentStageCode,
      data.pageSize,
      defaultButlerId,
      hasCurrentBlockers,
      load,
      plannerId,
      search,
      serviceStatus,
      sortBy,
    ],
  );

  useEffect(() => {
    void load(initialInput);
    if (administratorView) {
      void getResponsiblePersonOptions()
        .then(setOptions)
        .catch(() => undefined);
    }
  }, [administratorView, initialInput, load]);

  const clearFilters = () => {
    setSearch("");
    setServiceStatus(undefined);
    setDefaultButlerId(undefined);
    setPlannerId(undefined);
    setCurrentStageCode(undefined);
    setHasCurrentBlockers(undefined);
    setSortBy(undefined);
    void load({ page: 1, pageSize: data.pageSize });
  };

  const listReturnParams = new URLSearchParams({
    page: String(data.page),
    pageSize: String(data.pageSize),
  });
  if (activeInput.search?.trim()) listReturnParams.set("search", activeInput.search.trim());
  if (activeInput.serviceStatus) listReturnParams.set("serviceStatus", activeInput.serviceStatus);
  if (activeInput.defaultButlerId) {
    listReturnParams.set("defaultButlerId", activeInput.defaultButlerId);
  }
  if (activeInput.plannerId) listReturnParams.set("plannerId", activeInput.plannerId);
  if (activeInput.currentStageCode) {
    listReturnParams.set("currentStageCode", activeInput.currentStageCode);
  }
  if (activeInput.hasCurrentBlockers !== undefined) {
    listReturnParams.set("hasCurrentBlockers", String(activeInput.hasCurrentBlockers));
  }
  if (activeInput.sortBy) listReturnParams.set("sortBy", activeInput.sortBy);
  const listReturnHref = `/workspace/students?${listReturnParams.toString()}`;

  const hasFilters = Boolean(
    search ||
    serviceStatus ||
    defaultButlerId ||
    plannerId ||
    currentStageCode ||
    hasCurrentBlockers !== undefined ||
    sortBy,
  );

  return (
    <PermissionPage
      anyPermissions={[PermissionCode.STUDENTS_READ, PermissionCode.STUDENTS_OWN_READ]}
    >
      <main className={styles.page}>
        <section className={styles.compactHero}>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>Student operations</span>
            <h1 className={styles.compactTitle}>学生管理</h1>
            <p className={styles.lead}>
              {administratorView
                ? "查看学生档案、负责人和八阶段服务进度，及时定位阻塞、逾期与前序遗留任务。"
                : "按学生维度查看本人当前负责学生的八阶段服务进度；此页面为只读视图。"}
            </p>
            {administratorView ? (
              <div className={styles.heroActions}>
                <Link href="/workspace/students/new">
                  <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined />}
                    className={styles.primaryButton}
                  >
                    新建学生
                  </Button>
                </Link>
              </div>
            ) : null}
          </div>
        </section>

        <section className={`${styles.section} ${styles.surface}`} aria-busy={loading}>
          <div className={styles.filterBar} role="search" aria-label="筛选学生">
            <Input
              className={styles.filterControl}
              size="large"
              allowClear
              prefix={<SearchOutlined aria-hidden />}
              placeholder="搜索姓名、编号、电话或邮箱"
              aria-label="搜索学生"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onPressEnter={() => void applyFilters(1)}
            />
            <Select
              className={styles.filterControl}
              size="large"
              allowClear
              placeholder="全部服务状态"
              aria-label="服务状态"
              value={serviceStatus}
              onChange={setServiceStatus}
              options={[
                { value: "NOT_ENABLED", label: "未启用" },
                { value: "ENABLED", label: "已启用" },
              ]}
            />
            {administratorView ? (
              <>
                <Select
                  className={styles.filterControl}
                  size="large"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="全部管家"
                  aria-label="默认管家"
                  value={defaultButlerId}
                  onChange={setDefaultButlerId}
                  options={options.butlers.map((person) => ({
                    value: person.id,
                    label: person.displayName,
                  }))}
                />
                <Select
                  className={styles.filterControl}
                  size="large"
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="全部规划老师"
                  aria-label="规划老师"
                  value={plannerId}
                  onChange={setPlannerId}
                  options={options.planners.map((person) => ({
                    value: person.id,
                    label: person.displayName,
                  }))}
                />
              </>
            ) : null}
            <Select
              className={styles.filterControl}
              size="large"
              allowClear
              placeholder="全部当前阶段"
              aria-label="当前阶段"
              value={currentStageCode}
              onChange={setCurrentStageCode}
              options={[
                ["PROFILE", "01 建档阶段"],
                ["ASSESSMENT", "02 学情评估阶段"],
                ["PLANNING", "03 升学规划阶段"],
                ["MATERIALS", "04 资料准备阶段"],
                ["ESSAYS", "05 文书准备阶段"],
                ["SUBMISSION", "06 申请递交阶段"],
                ["RESULTS", "07 申请结果跟进阶段"],
                ["ENROLLMENT", "08 入学确认阶段"],
              ].map(([value, label]) => ({ value, label }))}
            />
            <Select
              className={styles.filterControl}
              size="large"
              allowClear
              placeholder="全部阻塞情况"
              aria-label="当前阶段阻塞情况"
              value={hasCurrentBlockers}
              onChange={setHasCurrentBlockers}
              options={[
                { value: true, label: "存在未完成阻塞任务" },
                { value: false, label: "当前无阻塞任务" },
              ]}
            />
            <Select
              className={styles.filterControl}
              size="large"
              allowClear
              placeholder="默认排序"
              aria-label="学生排序"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: "stageProgress", label: "按阶段进度排序" },
                { value: "currentBlockers", label: "按当前阻塞数排序" },
                { value: "overdueTasks", label: "按逾期任务数排序" },
              ]}
            />
            <Button
              size="large"
              type="primary"
              className={styles.primaryButton}
              onClick={() => void applyFilters(1)}
            >
              筛选
            </Button>
          </div>

          {error ? (
            <Alert
              type="error"
              showIcon
              title="学生列表暂时无法加载"
              description={error}
              action={<Button onClick={() => void applyFilters(data.page)}>重试</Button>}
            />
          ) : loading ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : data.items.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyOrb} aria-hidden />
              <h2 className={styles.emptyTitle}>
                {hasFilters ? "没有符合条件的学生" : "暂无学生"}
              </h2>
              <p className={styles.emptyCopy}>
                {hasFilters
                  ? "调整筛选条件，或清除筛选查看全部学生。"
                  : administratorView
                    ? "新建第一位学生，只需填写姓名即可保存。"
                    : "当前没有由你担任默认管家的学生。"}
              </p>
              {hasFilters ? (
                <Button className={styles.secondaryButton} onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : administratorView ? (
                <Link href="/workspace/students/new">
                  <Button type="primary" className={styles.primaryButton}>
                    新建第一位学生
                  </Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">学生</th>
                      {administratorView ? <th scope="col">联系方式</th> : null}
                      {administratorView ? <th scope="col">默认管家</th> : null}
                      {administratorView ? <th scope="col">规划老师</th> : null}
                      <th scope="col">服务状态</th>
                      <th scope="col">当前阶段</th>
                      <th scope="col">阶段进度</th>
                      <th scope="col">阻塞 / 逾期 / 遗留</th>
                      <th scope="col">最近更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <Link
                            href={`/workspace/students/${student.id}?returnTo=${encodeURIComponent(
                              listReturnHref,
                            )}`}
                            className={styles.studentLink}
                          >
                            {student.name}
                          </Link>
                          <span className={styles.secondaryText}>{student.studentNo}</span>
                        </td>
                        {administratorView ? (
                          <td>
                            {student.phone ?? "未填写"}
                            <span className={styles.secondaryText}>
                              {student.email ?? "未填写邮箱"}
                            </span>
                          </td>
                        ) : null}
                        {administratorView ? (
                          <td>
                            <Person person={student.defaultButler} />
                          </td>
                        ) : null}
                        {administratorView ? (
                          <td>
                            <Person person={student.planner ?? null} />
                          </td>
                        ) : null}
                        <td>
                          <span
                            className={`${styles.statusPill} ${
                              student.serviceStatus === "ENABLED" ? styles.statusPillEnabled : ""
                            }`}
                          >
                            <span className={styles.statusDot} aria-hidden />
                            {student.serviceStatus === "ENABLED" ? "已启用" : "未启用"}
                          </span>
                        </td>
                        <td>
                          {student.serviceStatus !== "ENABLED" ? (
                            "—"
                          ) : student.progress?.calculationStatus !== "NORMAL" ? (
                            <Tag
                              color={
                                student.progress?.calculationStatus === "ERROR" ? "error" : "blue"
                              }
                            >
                              {student.progress?.calculationStatus === "ERROR"
                                ? "进度数据异常"
                                : "进度更新中"}
                            </Tag>
                          ) : student.progress?.currentStage ? (
                            <>
                              {student.progress.currentStage.name}
                              <span className={styles.secondaryText}>
                                第 {student.progress.currentStage.sequenceNo} 阶段
                              </span>
                            </>
                          ) : (
                            "全部阶段已完成"
                          )}
                        </td>
                        <td>
                          {student.progress?.calculationStatus === "NORMAL"
                            ? `${student.progress.completedStageCount}/${student.progress.totalStageCount}`
                            : "—"}
                        </td>
                        <td>
                          {student.progress?.calculationStatus === "NORMAL" ? (
                            <span className={styles.secondaryText}>
                              阻塞 {student.progress.currentBlockingTaskCount} · 逾期{" "}
                              {student.progress.overdueTaskCount} · 遗留{" "}
                              {student.progress.legacyTaskCount}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>{new Date(student.updatedAt).toLocaleString("zh-HK")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={styles.pagination}>
                <Pagination
                  current={data.page}
                  pageSize={data.pageSize}
                  total={data.total}
                  showSizeChanger
                  showTotal={(total) => `共 ${total} 位学生`}
                  onChange={(page, pageSize) => void applyFilters(page, pageSize)}
                />
              </div>
            </>
          )}
        </section>
      </main>
    </PermissionPage>
  );
}
