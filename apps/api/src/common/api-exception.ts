import { HttpException } from "@nestjs/common";
import type { ErrorCode } from "@dse/shared";

export class ApiException extends HttpException {
  public constructor(
    status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}
