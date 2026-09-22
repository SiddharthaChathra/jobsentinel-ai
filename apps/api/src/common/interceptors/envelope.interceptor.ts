import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

/** Marker for controller methods that already return `{ data, meta }`. */
export const ALREADY_ENVELOPED = Symbol('ALREADY_ENVELOPED');

/** Wraps controller return values as `{ data }` (docs 03 §1). `undefined` passes through (204). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const path = ctx.switchToHttp().getRequest<{ path?: string }>().path ?? '';
    if (path.startsWith('/health')) return next.handle();
    return next.handle().pipe(
      map((value: unknown) => {
        if (value === undefined || value === null) return value;
        if (typeof value === 'object' && ALREADY_ENVELOPED in value) {
          const { [ALREADY_ENVELOPED]: _flag, ...rest } = value as Record<string | symbol, unknown>;
          return rest;
        }
        return { data: value };
      }),
    );
  }
}

/** Helper for paginated responses: `return enveloped(items, { nextCursor })`. */
export function enveloped<T>(data: T, meta: Record<string, unknown>) {
  return { [ALREADY_ENVELOPED]: true, data, meta };
}
