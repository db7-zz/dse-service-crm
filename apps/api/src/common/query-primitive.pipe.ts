import { Injectable, ValidationPipe, type ArgumentMetadata } from "@nestjs/common";

const NUMBER_QUERY_KEYS = new Set(["page", "pageSize", "cohortYear"]);
const BOOLEAN_QUERY_KEYS = new Set([
  "attentionOnly",
  "hasCurrentBlockers",
  "hasMissingMaterials",
  "openAlert",
  "overdue",
  "overdueOnly",
  "unassigned",
  "unreadOnly",
]);

@Injectable()
export class QueryPrimitivePipe extends ValidationPipe {
  public constructor() {
    super({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  }

  public override transform(value: unknown, metadata: ArgumentMetadata) {
    return super.transform(this.normalizeQuery(value, metadata), metadata);
  }

  private normalizeQuery(value: unknown, metadata: ArgumentMetadata): unknown {
    if (
      metadata.type !== "query" ||
      !metadata.metatype ||
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return value;
    }

    const normalized: Record<string, unknown> = {
      ...(value as Record<string, unknown>),
    };

    for (const [key, rawValue] of Object.entries(normalized)) {
      const expectedType: unknown = Reflect.getMetadata(
        "design:type",
        metadata.metatype.prototype,
        key,
      );

      if ((expectedType === Number || NUMBER_QUERY_KEYS.has(key)) && typeof rawValue === "string") {
        normalized[key] = Number(rawValue);
      } else if ((expectedType === Boolean || BOOLEAN_QUERY_KEYS.has(key)) && rawValue === "true") {
        normalized[key] = true;
      } else if (
        (expectedType === Boolean || BOOLEAN_QUERY_KEYS.has(key)) &&
        rawValue === "false"
      ) {
        normalized[key] = false;
      }
    }

    return normalized;
  }
}
