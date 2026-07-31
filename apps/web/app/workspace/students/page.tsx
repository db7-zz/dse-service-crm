"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Pagination, Select, Skeleton } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import { getResponsiblePersonOptions, listStudents } from "../../../src/students/student-api";
import type {
  ResponsiblePersonOptions,
  StudentPageData,
  StudentPerson,
} from "../../../src/students/student-types";
import styles from "../../../src/students/student-page.module.css";

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
  const [data, setData] = useState<StudentPageData>({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const [options, setOptions] = useState<ResponsiblePersonOptions>({
    butlers: [],
    planners: [],
  });
  const [search, setSearch] = useState("");
  const [serviceStatus, setServiceStatus] = useState<string>();
  const [defaultButlerId, setDefaultButlerId] = useState<string>();
  const [plannerId, setPlannerId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (input: {
      page: number;
      pageSize: number;
      search?: string;
      serviceStatus?: string;
      defaultButlerId?: string;
      plannerId?: string;
    }) => {
      setLoading(true);
      setError(undefined);
      try {
        setData(await listStudents(input));
      } catch (exception) {
        setError(exception instanceof Error ? exception.message : "学生列表加载失败");
      } finally {
        setLoading(false);
      }
    },
    [],
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
      }),
    [data.pageSize, defaultButlerId, load, plannerId, search, serviceStatus],
  );

  useEffect(() => {
    void load({ page: 1, pageSize: 20 });
    void getResponsiblePersonOptions()
      .then(setOptions)
      .catch(() => undefined);
  }, [load]);

  const clearFilters = () => {
    setSearch("");
    setServiceStatus(undefined);
    setDefaultButlerId(undefined);
    setPlannerId(undefined);
    void load({ page: 1, pageSize: data.pageSize });
  };

  return (
    <PermissionPage permission={PermissionCode.STUDENTS_READ}>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <span className={styles.eyebrow}>Student operations</span>
            <h1 className={styles.title}>每一位学生，都从一份清晰档案开始。</h1>
            <p className={styles.lead}>
              在一个视图里查看联系方式、默认管家、规划老师和服务状态。负责人可以先留空，待安排明确后再补充。
            </p>
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
                {search || serviceStatus || defaultButlerId || plannerId
                  ? "没有符合条件的学生"
                  : "还没有学生档案"}
              </h2>
              <p className={styles.emptyCopy}>
                {search || serviceStatus || defaultButlerId || plannerId
                  ? "调整筛选条件，或清除筛选查看全部学生。"
                  : "新建第一位学生，只需填写姓名即可保存。"}
              </p>
              {search || serviceStatus || defaultButlerId || plannerId ? (
                <Button className={styles.secondaryButton} onClick={clearFilters}>
                  清除筛选
                </Button>
              ) : (
                <Link href="/workspace/students/new">
                  <Button type="primary" className={styles.primaryButton}>
                    新建第一位学生
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">学生</th>
                      <th scope="col">联系方式</th>
                      <th scope="col">默认管家</th>
                      <th scope="col">规划老师</th>
                      <th scope="col">服务状态</th>
                      <th scope="col">最近更新</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((student) => (
                      <tr key={student.id}>
                        <td>
                          <Link
                            href={`/workspace/students/${student.id}`}
                            className={styles.studentLink}
                          >
                            {student.name}
                          </Link>
                          <span className={styles.secondaryText}>{student.studentNo}</span>
                        </td>
                        <td>
                          {student.phone ?? "未填写"}
                          <span className={styles.secondaryText}>
                            {student.email ?? "未填写邮箱"}
                          </span>
                        </td>
                        <td>
                          <Person person={student.defaultButler} />
                        </td>
                        <td>
                          <Person person={student.planner} />
                        </td>
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
