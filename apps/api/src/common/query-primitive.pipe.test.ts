import "reflect-metadata";
import type { ArgumentMetadata } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { ListStudentsQueryDto } from "../students/students.dto.js";
import { QueryPrimitivePipe } from "./query-primitive.pipe.js";

const metadata: ArgumentMetadata = {
  type: "query",
  metatype: ListStudentsQueryDto,
  data: undefined,
};

describe("QueryPrimitivePipe", () => {
  it("normalizes query numbers and booleans before DTO validation", async () => {
    const validated = await new QueryPrimitivePipe().transform(
      {
        page: "1",
        pageSize: "20",
        hasCurrentBlockers: "false",
        sortOrder: "desc",
      },
      metadata,
    );
    expect(validated).toMatchObject({
      page: 1,
      pageSize: 20,
      hasCurrentBlockers: false,
      sortOrder: "desc",
    });
  });

  it("leaves invalid query values for the DTO validator to reject", async () => {
    await expect(
      new QueryPrimitivePipe().transform({ page: "invalid" }, metadata),
    ).rejects.toThrow();
  });
});
