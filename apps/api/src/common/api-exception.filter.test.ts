import { BadRequestException, HttpException, HttpStatus, NotFoundException } from "@nestjs/common";
import { ErrorCode } from "@dse/shared";
import { describe, expect, it } from "vitest";
import { mapApiException } from "./api-exception.filter.js";

describe("mapApiException", () => {
  it("maps validation details without exposing an internal exception", () => {
    const mapped = mapApiException(
      new BadRequestException({
        message: ["password must be longer than or equal to 12 characters"],
      }),
    );
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(mapped.details).toHaveProperty("validation");
  });

  it("maps common infrastructure responses to stable error codes", () => {
    expect(mapApiException(new NotFoundException()).code).toBe(ErrorCode.RESOURCE_NOT_FOUND);
    expect(
      mapApiException(new HttpException("Too many requests", HttpStatus.TOO_MANY_REQUESTS)).code,
    ).toBe(ErrorCode.RATE_LIMITED);
    expect(mapApiException(new Error("database password leaked")).message).not.toContain(
      "password",
    );
  });
});
