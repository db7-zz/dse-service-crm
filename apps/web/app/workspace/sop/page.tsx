"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  PlusOutlined,
  RocketOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Input, InputNumber, Modal, Skeleton, Switch, Tag } from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import {
  createSopDraft,
  listSopVersions,
  publishSopVersion,
  saveSopDraft,
  validateSopVersion,
} from "../../../src/sop/sop-api";
import type { SopStageTemplate, SopValidationResult, SopVersion } from "../../../src/sop/sop-types";
import styles from "../../../src/sop/sop-page.module.css";

const STATUS_LABELS = {
  DRAFT: { label: "草稿", color: "blue" },
  PUBLISHED: { label: "当前发布", color: "green" },
  RETIRED: { label: "历史版本", color: "default" },
} as const;

function normalizeStages(stages: SopStageTemplate[]) {
  return stages.map((stage, stageIndex) => ({
    ...stage,
    sequenceNo: stageIndex + 1,
    tasks: stage.tasks.map((task, taskIndex) => ({
      ...task,
      sequenceNo: taskIndex + 1,
    })),
  }));
}

export default function SopPage() {
  const { message } = App.useApp();
  const [versions, setVersions] = useState<SopVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<SopVersion>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [validation, setValidation] = useState<SopValidationResult>();

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await listSopVersions();
      setVersions(result.items);
      const nextId =
        preferredId ??
        result.draftVersionId ??
        result.currentPublishedVersionId ??
        result.items[0]?.id;
      setSelectedId(nextId);
      setDraft(result.items.find((item) => item.id === nextId));
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "SOP 版本加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = draft?.status === "DRAFT";

  const changeStage = (
    stageIndex: number,
    updater: (stage: SopStageTemplate) => SopStageTemplate,
  ) => {
    if (!draft || !editable) return;
    setValidation(undefined);
    setDraft({
      ...draft,
      stages: normalizeStages(
        draft.stages.map((stage, index) => (index === stageIndex ? updater(stage) : stage)),
      ),
    });
  };

  const save = async () => {
    if (!draft) return undefined;
    setWorking(true);
    try {
      const saved = await saveSopDraft(draft.id, draft.version, draft.stages);
      setDraft(saved);
      setVersions((items) => items.map((item) => (item.id === saved.id ? saved : item)));
      await message.success("SOP 草稿已保存");
      return saved;
    } catch (exception) {
      await message.error(exception instanceof Error ? exception.message : "保存失败");
      return undefined;
    } finally {
      setWorking(false);
    }
  };

  return (
    <PermissionPage permission={PermissionCode.SOP_READ}>
      <main className={styles.page}>
        <section className={`${styles.hero} ${styles.compactHero}`}>
          <div>
            <span className={styles.eyebrow}>Service operating procedure</span>
            <h1 className={styles.title}>八阶段 SOP</h1>
            <p className={styles.lead}>
              用一个已发布版本驱动学生服务启用。发布后的版本保持只读，新的草稿从当前版本完整复制。
            </p>
          </div>
          <Button
            type="primary"
            size="large"
            icon={<PlusOutlined />}
            disabled={versions.some((version) => version.status === "DRAFT")}
            loading={working}
            onClick={async () => {
              setWorking(true);
              try {
                const created = await createSopDraft();
                await load(created.id);
                await message.success(`${created.displayVersion} 草稿已创建`);
              } catch (exception) {
                await message.error(
                  exception instanceof Error ? exception.message : "创建草稿失败",
                );
              } finally {
                setWorking(false);
              }
            }}
          >
            新建下一版
          </Button>
        </section>

        {error ? (
          <Alert
            style={{ marginTop: 20 }}
            showIcon
            type="error"
            title="SOP 暂时无法加载"
            description={error}
            action={<Button onClick={() => void load()}>重试</Button>}
          />
        ) : null}

        <div className={styles.layout}>
          <aside className={styles.glass}>
            <div className={styles.versionList}>
              {versions.map((version) => {
                const status = STATUS_LABELS[version.status];
                return (
                  <button
                    type="button"
                    key={version.id}
                    className={`${styles.versionButton} ${
                      selectedId === version.id ? styles.versionButtonActive : ""
                    }`}
                    onClick={() => {
                      setSelectedId(version.id);
                      setDraft(version);
                      setValidation(undefined);
                    }}
                  >
                    <span className={styles.versionTitle}>
                      {version.displayVersion}
                      <Tag color={status.color}>{status.label}</Tag>
                    </span>
                    <span className={styles.versionMeta}>
                      {version.stageCount} 阶段 · {version.taskCount} 任务
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className={styles.glass}>
            {loading || !draft ? (
              <Skeleton active paragraph={{ rows: 12 }} />
            ) : (
              <>
                <div className={styles.editorHeader}>
                  <div>
                    <h2>
                      {draft.displayVersion} · {STATUS_LABELS[draft.status].label}
                    </h2>
                    <span style={{ color: "#6e6e73" }}>
                      {editable ? "草稿可编辑；保存后再校验和发布" : "版本内容已锁定，只供追溯"}
                    </span>
                  </div>
                  <Tag color={STATUS_LABELS[draft.status].color}>
                    {draft.stages.length} 阶段 /{" "}
                    {draft.stages.reduce((sum, stage) => sum + stage.tasks.length, 0)} 任务
                  </Tag>
                </div>

                {validation ? (
                  <Alert
                    style={{ marginBottom: 16 }}
                    showIcon
                    type={validation.valid ? "success" : "warning"}
                    title={validation.valid ? "SOP 完整性校验通过" : "SOP 还不能发布"}
                    description={
                      validation.valid
                        ? "八个阶段均至少有一项阻塞任务，所有完成时限均为整数小时。"
                        : validation.errors.map((item) => item.message).join("；")
                    }
                  />
                ) : null}

                <div className={styles.stageList}>
                  {draft.stages.map((stage, stageIndex) => (
                    <article className={styles.stage} key={`${stage.stageCode}-${stageIndex}`}>
                      <div className={styles.stageHeader}>
                        <span className={styles.stageNumber}>{stageIndex + 1}</span>
                        <Input
                          value={stage.stageCode}
                          disabled={!editable}
                          aria-label={`第${stageIndex + 1}阶段代码`}
                          onChange={(event) =>
                            changeStage(stageIndex, (current) => ({
                              ...current,
                              stageCode: event.target.value.toUpperCase(),
                            }))
                          }
                        />
                        <Input
                          value={stage.name}
                          disabled={!editable}
                          aria-label={`第${stageIndex + 1}阶段名称`}
                          onChange={(event) =>
                            changeStage(stageIndex, (current) => ({
                              ...current,
                              name: event.target.value,
                            }))
                          }
                        />
                      </div>
                      <div className={styles.tasks}>
                        {stage.tasks.length === 0 ? (
                          <div className={styles.empty}>至少添加一项由管家执行的任务</div>
                        ) : null}
                        {stage.tasks.map((task, taskIndex) => (
                          <div className={styles.task} key={task.id ?? taskIndex}>
                            <Input
                              value={task.name}
                              disabled={!editable}
                              placeholder="任务名称"
                              onChange={(event) =>
                                changeStage(stageIndex, (current) => ({
                                  ...current,
                                  tasks: current.tasks.map((item, index) =>
                                    index === taskIndex
                                      ? { ...item, name: event.target.value }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            <InputNumber
                              min={1}
                              precision={0}
                              aria-label={`${task.name || "未命名任务"}完成时限（小时）`}
                              value={task.completionWindowHours}
                              disabled={!editable}
                              onChange={(value) =>
                                changeStage(stageIndex, (current) => ({
                                  ...current,
                                  tasks: current.tasks.map((item, index) =>
                                    index === taskIndex
                                      ? {
                                          ...item,
                                          completionWindowHours:
                                            typeof value === "number" ? value : 1,
                                        }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            <Input.TextArea
                              autoSize={{ minRows: 1, maxRows: 3 }}
                              value={task.completionCriteria ?? ""}
                              disabled={!editable}
                              placeholder="完成标准"
                              onChange={(event) =>
                                changeStage(stageIndex, (current) => ({
                                  ...current,
                                  tasks: current.tasks.map((item, index) =>
                                    index === taskIndex
                                      ? {
                                          ...item,
                                          completionCriteria: event.target.value || null,
                                        }
                                      : item,
                                  ),
                                }))
                              }
                            />
                            <label className={styles.blockingControl}>
                              <Switch
                                checked={task.isBlocking}
                                disabled={!editable}
                                onChange={(checked) =>
                                  changeStage(stageIndex, (current) => ({
                                    ...current,
                                    tasks: current.tasks.map((item, index) =>
                                      index === taskIndex ? { ...item, isBlocking: checked } : item,
                                    ),
                                  }))
                                }
                              />
                              <span>
                                阻塞阶段
                                <small>全部阻塞任务完成或取消后自动推进</small>
                              </span>
                            </label>
                            {editable ? (
                              <Button
                                danger
                                type="text"
                                aria-label={`删除任务 ${task.name}`}
                                icon={<DeleteOutlined />}
                                onClick={() =>
                                  changeStage(stageIndex, (current) => ({
                                    ...current,
                                    tasks: current.tasks.filter((_, index) => index !== taskIndex),
                                  }))
                                }
                              />
                            ) : null}
                          </div>
                        ))}
                        {editable ? (
                          <Button
                            block
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={() =>
                              changeStage(stageIndex, (current) => ({
                                ...current,
                                tasks: [
                                  ...current.tasks,
                                  {
                                    name: "",
                                    sequenceNo: current.tasks.length + 1,
                                    description: null,
                                    completionCriteria: null,
                                    completionWindowHours: 24,
                                    ownerRole: "BUTLER",
                                    isBlocking: true,
                                  },
                                ],
                              }))
                            }
                          >
                            添加任务
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>

                {editable ? (
                  <div className={styles.footer}>
                    <Button icon={<SaveOutlined />} loading={working} onClick={() => void save()}>
                      保存草稿
                    </Button>
                    <Button
                      icon={<CheckCircleOutlined />}
                      disabled={working}
                      onClick={async () => {
                        const saved = await save();
                        if (!saved) return;
                        setValidation(await validateSopVersion(saved.id));
                      }}
                    >
                      保存并校验
                    </Button>
                    <Button
                      type="primary"
                      icon={<RocketOutlined />}
                      disabled={working}
                      onClick={async () => {
                        const saved = await save();
                        if (!saved) return;
                        const result = await validateSopVersion(saved.id);
                        setValidation(result);
                        if (!result.valid) return;
                        Modal.confirm({
                          title: `发布 ${saved.displayVersion}？`,
                          content: "发布后该版本将保持只读，当前已发布版本会自动转为历史版本。",
                          okText: "确认发布",
                          cancelText: "取消",
                          onOk: async () => {
                            const published = await publishSopVersion(saved.id, saved.version);
                            await message.success(`${published.displayVersion} 已发布`);
                            await load(published.id);
                          },
                        });
                      }}
                    >
                      发布版本
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </section>
        </div>
      </main>
    </PermissionPage>
  );
}
