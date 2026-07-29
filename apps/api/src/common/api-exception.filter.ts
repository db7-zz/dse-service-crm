import type { ApiEnvelope } from "@dse/shared";
import { ErrorCode } from "@dse/shared";
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Response } from "express";
import { ApiException } from "./api-exception.js";
import type { RequestContext } from "./request-context.js";

export interface MappedApiException {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export function mapApiException(exception: unknown): MappedApiException {
  let status = HttpStatus.INTERNAL_SERVER_ERROR;
  let code: string = ErrorCode.INTERNAL_ERROR;
  let message = "系统暂时无法处理该请求";
  let details: Record<string, unknown> = {};

  if (exception instanceof ApiException) {
    status = exception.getStatus();
    code = exception.code;
    message = exception.message;
    details = exception.details;
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    const body = exception.getResponse();
    if (status === HttpStatus.BAD_REQUEST) {
      code = ErrorCode.VALIDATION_ERROR;
      message = "请求参数不符合要求";
      details = typeof body === "object" ? { validation: body } : {};
    } else if (status === HttpStatus.UNAUTHORIZED) {
      code = ErrorCode.UNAUTHENTICATED;
      message = "请先登录";
    } else if (status === HttpStatus.FORBIDDEN) {
      code = ErrorCode.FORBIDDEN;
      message = "无权执行该操作";
    } else if (status === HttpStatus.TOO_MANY_REQUESTS) {
      code = ErrorCode.RATE_LIMITED;
      message = "请求过于频繁，请稍后重试";
    } else if (status === HttpStatus.NOT_FOUND) {
      code = ErrorCode.RESOURCE_NOT_FOUND;
      message = "请求的资源不存在";
    } else if (status === HttpStatus.CONFLICT) {
      code = ErrorCode.CONFLICT;
      message = "请求与当前数据状态冲突";
    }
  }

  return { status, code, message, details };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestContext>();
    const response = http.getResponse<Response>();

    const { status, code, message, details } = mapApiException(exception);

    if (status >= 500) {
      this.logger.error(
        {
          requestId: request.requestId,
          method: request.method,
          path: request.path,
          exception,
        },
        "Unhandled request exception",
      );
    }

    const envelope: ApiEnvelope<never> = {
      success: false,
      data: null,
      error: { code, message, details },
      requestId: request.requestId,
    };
    response.status(status).json(envelope);
  }
}
