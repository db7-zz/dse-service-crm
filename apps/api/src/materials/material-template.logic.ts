export type MaterialDeadlineRule = "ACTIVATION_OFFSET" | "STAGE_OFFSET" | "FIXED_DATE";

export type MaterialConditionField =
  | "cohortYear"
  | "grade"
  | "identityCategory"
  | "examCandidateType"
  | "targetDirection"
  | "dseSubjects";

export interface MaterialConditionRule {
  field: MaterialConditionField;
  operator: "EQUALS" | "IN" | "CONTAINS";
  value: string | number | Array<string | number>;
}

export interface MaterialConditionSubject {
  cohortYear: number | null;
  grade: string | null;
  identityCategory: string | null;
  examCandidateType: string | null;
  targetDirection: string | null;
  dseSubjects: string[];
}

const CONDITION_FIELDS = new Set<MaterialConditionField>([
  "cohortYear",
  "grade",
  "identityCategory",
  "examCandidateType",
  "targetDirection",
  "dseSubjects",
]);

export function calculateMaterialDueAt(input: {
  rule: MaterialDeadlineRule;
  offsetDays: number | null;
  fixedDueAt: Date | null;
  activationAt: Date;
  stageStartedAt: Date | null;
}) {
  if (input.rule === "FIXED_DATE") return input.fixedDueAt;
  if (input.offsetDays === null || input.offsetDays < 0) return null;
  const anchor = input.rule === "ACTIVATION_OFFSET" ? input.activationAt : input.stageStartedAt;
  if (!anchor) return null;
  return new Date(anchor.getTime() + input.offsetDays * 24 * 60 * 60 * 1000);
}

export function parseMaterialConditionRule(value: unknown): MaterialConditionRule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const operator = String(input.operator);
  if (
    typeof input.field !== "string" ||
    !CONDITION_FIELDS.has(input.field as MaterialConditionField) ||
    !["EQUALS", "IN", "CONTAINS"].includes(operator) ||
    !isConditionValue(input.value) ||
    (operator === "EQUALS" && Array.isArray(input.value)) ||
    (operator === "IN" && !Array.isArray(input.value))
  ) {
    return null;
  }
  return input as unknown as MaterialConditionRule;
}

export function matchesMaterialCondition(value: unknown, subject: MaterialConditionSubject) {
  const rule = parseMaterialConditionRule(value);
  if (!rule) return false;
  const actual = subject[rule.field];
  if (actual === null || actual === undefined) return false;
  if (rule.operator === "EQUALS") {
    return Array.isArray(actual)
      ? actual.some((entry) => normalize(entry) === normalize(rule.value))
      : normalize(actual) === normalize(rule.value);
  }
  if (rule.operator === "IN") {
    if (!Array.isArray(rule.value)) return false;
    const accepted = new Set(rule.value.map(normalize));
    return Array.isArray(actual)
      ? actual.some((entry) => accepted.has(normalize(entry)))
      : accepted.has(normalize(actual));
  }
  const expected = Array.isArray(rule.value) ? rule.value.map(normalize) : [normalize(rule.value)];
  return Array.isArray(actual)
    ? expected.every((entry) => actual.map(normalize).includes(entry))
    : expected.some((entry) => normalize(actual).includes(entry));
}

function isConditionValue(value: unknown): value is MaterialConditionRule["value"] {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    (Array.isArray(value) &&
      value.length > 0 &&
      value.every((entry) => typeof entry === "string" || typeof entry === "number"))
  );
}

function normalize(value: unknown) {
  return String(value).trim().toLocaleLowerCase("zh-CN");
}
