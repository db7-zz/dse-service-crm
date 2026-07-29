import type { ApiEnvelope } from "@dse/shared";
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";
import type { RequestContext } from "./request-context.js";

@Injectable()
export class ApiEnvelopeInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  public intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    const request = context.switchToHttp().getRequest<RequestContext>();
    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        error: null,
        requestId: request.requestId,
      })),
    );
  }
}
