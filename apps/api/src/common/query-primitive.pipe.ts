import { Injectable, ValidationPipe, type ArgumentMetadata } from "@nestjs/common";

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

      if (expectedType === Number && typeof rawValue === "string") {
        normalized[key] = Number(rawValue);
      } else if (expectedType === Boolean && rawValue === "true") {
        normalized[key] = true;
      } else if (expectedType === Boolean && rawValue === "false") {
        normalized[key] = false;
      }
    }

    return normalized;
  }
}
