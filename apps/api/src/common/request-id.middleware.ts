import { randomUUID } from "node:crypto";
import type { NextFunction, Response } from "express";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { RequestContext } from "./request-context.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  public use(request: RequestContext, response: Response, next: NextFunction): void {
    const supplied = request.header("X-Request-Id");
    request.requestId = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
    response.setHeader("X-Request-Id", request.requestId);
    next();
  }
}
