"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircleOutlined,
  DeleteOutlined,
  FileAddOutlined,
  PlusOutlined,
  RocketOutlined,
  SaveOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { PermissionCode } from "@dse/shared";
import { PermissionPage } from "../../../src/auth/permission-page";
import {
  applySopMaterialBackfill,
  createSopDraft,
  listSopMaterialTypes,
  listSopVersions,
  previewSopMaterialBackfill,
  publishSopVersion,
  saveSopDraft,
  validateSopVersion,
} from "../../../src/sop/sop-api";
import type {
  SopMaterialBackfillPreview,
  SopMaterialConditionRule,
  SopMaterialTemplate,
  SopMaterialType,
  SopStageTemplate,
  SopValidationResult,
  SopVersion,
} from "../../../src/sop/sop-types";
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
    materials: (stage.materials ?? []).map((material, materialIndex) => ({
      ...material,
      sequenceNo: materialIndex + 1,
    })),
  }));
}

function normalizeVersion(version: SopVersion): SopVersion {
  const stages = normalizeStages(version.stages);
  return {
    ...version,
    stages,
    materialCount:
      version.materialCount ?? stages.reduce((total, stage) => total + stage.materials.length, 0),
  };
}

const REQUIREMENT_KIND_OPTIONS = [
  { value: "REQUIRED", label: "必交" },
  { value: "CONDITIONAL", label: "条件必交" },
  { value: "OPTIONAL", label: "选交" },
] as const;

const DEADLINE_RULE_OPTIONS = [
  { value: "ACTIVATION_OFFSET", label: "启用服务后" },
  { value: "STAGE_OFFSET", label: "进入本阶段后" },
  { value: "FIXED_DATE", label: "固定日期" },
] as const;

const CONDITION_FIELD_OPTIONS = [
  { value: "cohortYear", label: "届别年份" },
  { value: "grade", label: "年级" },
  { value: "identityCategory", label: "身份类别" },
  { value: "examCandidateType", label: "考生类别" },
  { value: "targetDirection", label: "升学方向" },
  { value: "dseSubjects", label: "DSE 科目" },
] as const;

const CONDITION_OPERATOR_OPTIONS = [
  { value: "EQUALS", label: "等于" },
  { value: "IN", label: "属于任一值" },
  { value: "CONTAINS", label: "包含" },
] as const;

function conditionValueText(rule: SopMaterialConditionRule | null) {
  if (!rule) return "";
  return Array.isArray(rule.value) ? rule.value.join("，") : String(rule.value);
}

function parseConditionValue(
  value: string,
  field: SopMaterialConditionRule["field"],
  operator: SopMaterialConditionRule["operator"],
) {
  const entries = value
    .split(/[,，]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (field === "cohortYear" && /^\d+$/.test(entry) ? Number(entry) : entry));
  if (operator === "IN" || entries.length > 1) return entries;
  return entries[0] ?? "";
}

function toDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoDateTime(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default function SopPage() {
  const { message } = App.useApp();
  const [versions, setVersions] = useState<SopVersion[]>([]);
  const [materialTypes, setMaterialTypes] = useState<SopMaterialType[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<SopVersion>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [validation, setValidation] = useState<SopValidationResult>();
  const [backfillPreview, setBackfillPreview] = useState<SopMaterialBackfillPreview>();
  const [backfillWorking, setBackfillWorking] = useState(false);

  const load = useCallback(async (preferredId?: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const [result, types] = await Promise.all([listSopVersions(), listSopMaterialTypes()]);
      const normalizedVersions = result.items.map(normalizeVersion);
      setVersions(normalizedVersions);
      setMaterialTypes(types);
      const nextId =
        preferredId ??
        result.draftVersionId ??
        result.currentPublishedVersionId ??
        result.items[0]?.id;
      setSelectedId(nextId);
      setDraft(normalizedVersions.find((item) => item.id === nextId));
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

  const changeMaterial = (
    stageIndex: number,
    materialIndex: number,
    updater: (material: SopMaterialTemplate) => SopMaterialTemplate,
  ) => {
    changeStage(stageIndex, (stage) => ({
      ...stage,
      materials: stage.materials.map((material, index) =>
        index === materialIndex ? updater(material) : material,
      ),
    }));
  };

  const save = async () => {
    if (!draft) return undefined;
    setWorking(true);
    try {
      const saved = await saveSopDraft(draft.id, draft.version, draft.stages);
      const normalized = normalizeVersion(saved);
      setDraft(normalized);
      setVersions((items) => items.map((item) => (item.id === saved.id ? normalized : item)));
      await message.success("SOP 草稿已保存");
      return normalized;
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
                      setDraft(normalizeVersion(version));
                      setValidation(undefined);
                    }}
                  >
                    <span className={styles.versionTitle}>
                      {version.displayVersion}
                      <Tag color={status.color}>{status.label}</Tag>
                    </span>
                    <span className={styles.versionMeta}>
                      {version.stageCount} 阶段 · {version.taskCount} 任务 ·{" "}
                      {version.materialCount ?? 0} 项资料
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
                  <Space wrap>
                    <Tag color={STATUS_LABELS[draft.status].color}>
                      {draft.stages.length} 阶段 /{" "}
                      {draft.stages.reduce((sum, stage) => sum + stage.tasks.length, 0)} 任务 /{" "}
                      {draft.stages.reduce((sum, stage) => sum + stage.materials.length, 0)} 项资料
                    </Tag>
                    {draft.status === "PUBLISHED" ? (
                      <Button
                        icon={<SyncOutlined />}
                        loading={backfillWorking}
                        onClick={async () => {
                          setBackfillWorking(true);
                          try {
                            setBackfillPreview(await previewSopMaterialBackfill(draft.id));
                          } catch (exception) {
                            await message.error(
                              exception instanceof Error ? exception.message : "补发预览失败",
                            );
                          } finally {
                            setBackfillWorking(false);
                          }
                        }}
                      >
                        预览补发到既有学生
                      </Button>
                    ) : null}
                  </Space>
                </div>

                {validation ? (
                  <Alert
                    style={{ marginBottom: 16 }}
                    showIcon
                    type={validation.valid ? "success" : "warning"}
                    title={validation.valid ? "SOP 完整性校验通过" : "SOP 还不能发布"}
                    description={
                      validation.valid
                        ? `八个阶段、任务与 ${validation.materialCount ?? 0} 项资料模板均通过完整性校验。`
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
                      <div className={styles.sectionHeading}>
                        <div>
                          <strong>管家任务</strong>
                          <small>完成服务动作并推动阶段流转</small>
                        </div>
                        <Tag>{stage.tasks.length} 项</Tag>
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

                      <div className={styles.sectionHeading}>
                        <div>
                          <strong>学生资料</strong>
                          <small>启用服务时自动生成学生端上传窗口</small>
                        </div>
                        <Tag color="blue">{stage.materials.length} 项</Tag>
                      </div>
                      <div className={styles.materials}>
                        {stage.materials.length === 0 ? (
                          <div className={styles.empty}>本阶段尚未配置资料模板</div>
                        ) : null}
                        {stage.materials.map((material, materialIndex) => (
                          <div
                            className={styles.material}
                            key={material.id ?? material.templateKey ?? materialIndex}
                          >
                            <div className={styles.materialHeading}>
                              <span>资料 {materialIndex + 1}</span>
                              <strong>{material.title || "未命名资料"}</strong>
                              {material.materialType.isCore ? <Tag color="red">核心</Tag> : null}
                              {editable ? (
                                <Button
                                  danger
                                  type="text"
                                  aria-label={`删除资料 ${material.title || materialIndex + 1}`}
                                  icon={<DeleteOutlined />}
                                  onClick={() =>
                                    changeStage(stageIndex, (current) => ({
                                      ...current,
                                      materials: current.materials.filter(
                                        (_, index) => index !== materialIndex,
                                      ),
                                    }))
                                  }
                                />
                              ) : null}
                            </div>
                            <div className={styles.materialGrid}>
                              <label>
                                <span>资料类型</span>
                                <Select
                                  value={material.materialType.id}
                                  disabled={!editable}
                                  options={materialTypes.map((type) => ({
                                    value: type.id,
                                    label: `${type.name}${type.isCore ? " · 核心" : ""}`,
                                  }))}
                                  onChange={(materialTypeId) =>
                                    changeMaterial(stageIndex, materialIndex, (current) => ({
                                      ...current,
                                      materialType:
                                        materialTypes.find((type) => type.id === materialTypeId) ??
                                        current.materialType,
                                    }))
                                  }
                                />
                              </label>
                              <label className={styles.materialTitleField}>
                                <span>学生端名称</span>
                                <Input
                                  value={material.title}
                                  disabled={!editable}
                                  placeholder="例如：个人陈述素材"
                                  onChange={(event) =>
                                    changeMaterial(stageIndex, materialIndex, (current) => ({
                                      ...current,
                                      title: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                <span>提交要求</span>
                                <Select
                                  value={material.requirementKind}
                                  disabled={!editable}
                                  options={[...REQUIREMENT_KIND_OPTIONS]}
                                  onChange={(requirementKind) =>
                                    changeMaterial(stageIndex, materialIndex, (current) => ({
                                      ...current,
                                      requirementKind,
                                      conditionRule:
                                        requirementKind === "CONDITIONAL"
                                          ? (current.conditionRule ?? {
                                              field: "grade",
                                              operator: "EQUALS",
                                              value: "",
                                            })
                                          : null,
                                    }))
                                  }
                                />
                              </label>
                              <label>
                                <span>截止规则</span>
                                <Select
                                  value={material.deadlineRule}
                                  disabled={!editable}
                                  options={[...DEADLINE_RULE_OPTIONS]}
                                  onChange={(deadlineRule) =>
                                    changeMaterial(stageIndex, materialIndex, (current) => ({
                                      ...current,
                                      deadlineRule,
                                      deadlineOffsetDays:
                                        deadlineRule === "FIXED_DATE"
                                          ? null
                                          : (current.deadlineOffsetDays ?? 14),
                                      fixedDueAt:
                                        deadlineRule === "FIXED_DATE" ? current.fixedDueAt : null,
                                    }))
                                  }
                                />
                              </label>
                              {material.deadlineRule === "FIXED_DATE" ? (
                                <label>
                                  <span>固定截止时间</span>
                                  <Input
                                    type="datetime-local"
                                    value={toDateTimeLocal(material.fixedDueAt)}
                                    disabled={!editable}
                                    onChange={(event) =>
                                      changeMaterial(stageIndex, materialIndex, (current) => ({
                                        ...current,
                                        fixedDueAt: toIsoDateTime(event.target.value),
                                      }))
                                    }
                                  />
                                </label>
                              ) : (
                                <label>
                                  <span>偏移天数</span>
                                  <InputNumber
                                    min={0}
                                    precision={0}
                                    addonAfter="天"
                                    value={material.deadlineOffsetDays}
                                    disabled={!editable}
                                    onChange={(value) =>
                                      changeMaterial(stageIndex, materialIndex, (current) => ({
                                        ...current,
                                        deadlineOffsetDays: typeof value === "number" ? value : 0,
                                      }))
                                    }
                                  />
                                </label>
                              )}
                              {material.requirementKind === "CONDITIONAL" &&
                              material.conditionRule ? (
                                <div className={styles.conditionEditor}>
                                  <label>
                                    <span>适用字段</span>
                                    <Select
                                      value={material.conditionRule.field}
                                      disabled={!editable}
                                      options={[...CONDITION_FIELD_OPTIONS]}
                                      onChange={(field) =>
                                        changeMaterial(stageIndex, materialIndex, (current) => ({
                                          ...current,
                                          conditionRule: current.conditionRule
                                            ? {
                                                ...current.conditionRule,
                                                field,
                                                value: parseConditionValue(
                                                  conditionValueText(current.conditionRule),
                                                  field,
                                                  current.conditionRule.operator,
                                                ),
                                              }
                                            : null,
                                        }))
                                      }
                                    />
                                  </label>
                                  <label>
                                    <span>判断方式</span>
                                    <Select
                                      value={material.conditionRule.operator}
                                      disabled={!editable}
                                      options={[...CONDITION_OPERATOR_OPTIONS]}
                                      onChange={(operator) =>
                                        changeMaterial(stageIndex, materialIndex, (current) => ({
                                          ...current,
                                          conditionRule: current.conditionRule
                                            ? {
                                                ...current.conditionRule,
                                                operator,
                                                value: parseConditionValue(
                                                  conditionValueText(current.conditionRule),
                                                  current.conditionRule.field,
                                                  operator,
                                                ),
                                              }
                                            : null,
                                        }))
                                      }
                                    />
                                  </label>
                                  <label className={styles.conditionValueField}>
                                    <span>匹配值（多个值用逗号分隔）</span>
                                    <Input
                                      value={conditionValueText(material.conditionRule)}
                                      disabled={!editable}
                                      placeholder="例如：中六，重读生"
                                      onChange={(event) =>
                                        changeMaterial(stageIndex, materialIndex, (current) => ({
                                          ...current,
                                          conditionRule: current.conditionRule
                                            ? {
                                                ...current.conditionRule,
                                                value: parseConditionValue(
                                                  event.target.value,
                                                  current.conditionRule.field,
                                                  current.conditionRule.operator,
                                                ),
                                              }
                                            : null,
                                        }))
                                      }
                                    />
                                  </label>
                                </div>
                              ) : null}
                              <label className={styles.requirementField}>
                                <span>学生端提交说明</span>
                                <Input.TextArea
                                  autoSize={{ minRows: 2, maxRows: 5 }}
                                  value={material.requirement ?? ""}
                                  disabled={!editable}
                                  placeholder="说明需要上传哪些内容、格式和注意事项"
                                  onChange={(event) =>
                                    changeMaterial(stageIndex, materialIndex, (current) => ({
                                      ...current,
                                      requirement: event.target.value || null,
                                    }))
                                  }
                                />
                              </label>
                            </div>
                          </div>
                        ))}
                        {editable ? (
                          <Button
                            block
                            type="dashed"
                            icon={<FileAddOutlined />}
                            disabled={!materialTypes.length}
                            onClick={() => {
                              const materialType = materialTypes[0];
                              if (!materialType) return;
                              changeStage(stageIndex, (current) => ({
                                ...current,
                                materials: [
                                  ...current.materials,
                                  {
                                    materialType,
                                    title: materialType.name,
                                    requirement: null,
                                    requirementKind: materialType.isCore ? "REQUIRED" : "OPTIONAL",
                                    deadlineRule: "ACTIVATION_OFFSET",
                                    deadlineOffsetDays: 14,
                                    fixedDueAt: null,
                                    conditionRule: null,
                                    sequenceNo: current.materials.length + 1,
                                  },
                                ],
                              }));
                            }}
                          >
                            添加阶段资料
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
        <Modal
          title={
            backfillPreview ? `增量补发预览 · SOP v${backfillPreview.versionNo}` : "增量补发预览"
          }
          open={Boolean(backfillPreview)}
          width={760}
          okText="确认增量补发"
          cancelText="暂不补发"
          confirmLoading={backfillWorking}
          okButtonProps={{
            disabled: !backfillPreview?.materialCount,
          }}
          onCancel={() => setBackfillPreview(undefined)}
          onOk={async () => {
            if (!backfillPreview) return;
            setBackfillWorking(true);
            try {
              const result = await applySopMaterialBackfill(
                backfillPreview.sopVersionId,
                backfillPreview.previewFingerprint,
              );
              setBackfillPreview(undefined);
              await message.success(
                `已为 ${result.studentCount} 名学生补发 ${result.materialCount} 项资料，并生成 ${result.taskCount} 项任务`,
              );
            } catch (exception) {
              await message.error(
                exception instanceof Error ? exception.message : "增量补发失败，请重新预览",
              );
            } finally {
              setBackfillWorking(false);
            }
          }}
        >
          {backfillPreview ? (
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <Alert
                showIcon
                type={backfillPreview.materialCount ? "info" : "success"}
                title={
                  backfillPreview.materialCount
                    ? `将为 ${backfillPreview.studentCount} 名既有学生新增 ${backfillPreview.materialCount} 项缺少的资料`
                    : "所有既有学生均已拥有这版 SOP 的资料项"
                }
                description="只新增尚不存在的资料项，不覆盖、不删除学生已有资料，也不会修改已经提交或审核的文件。"
              />
              {backfillPreview.students.length ? (
                <List
                  bordered
                  size="small"
                  dataSource={backfillPreview.students.slice(0, 8)}
                  renderItem={(student) => (
                    <List.Item extra={<Tag color="blue">{student.materialCount} 项</Tag>}>
                      <List.Item.Meta
                        title={`${student.name} · ${student.studentNo}`}
                        description={student.materials
                          .slice(0, 3)
                          .map((material) => `${material.stageName} / ${material.title}`)
                          .join("；")}
                      />
                    </List.Item>
                  )}
                />
              ) : null}
              {backfillPreview.students.length > 8 ? (
                <Typography.Text type="secondary">
                  另有 {backfillPreview.students.length - 8}{" "}
                  名学生未在列表中展开，确认后仍会一并补发。
                </Typography.Text>
              ) : null}
            </Space>
          ) : null}
        </Modal>
      </main>
    </PermissionPage>
  );
}
