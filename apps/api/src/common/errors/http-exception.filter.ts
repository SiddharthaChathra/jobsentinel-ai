import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@jobsentinel/types';
import { ZodError } from 'zod';
import { AppError } from './app-error';

/** Maps every thrown error to the `{ error: { code, message, details, requestId } }` envelope. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiErrorBody['error'] = { code: 'INTERNAL_ERROR', message: 'Internal server error' };

    if (exception instanceof AppError) {
      status = exception.status;
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      const message =
        typeof resp === 'string'
          ? resp
          : ((resp as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: codeFromStatus(status),
        message: Array.isArray(message) ? message.join('; ') : message,
      };
    } else {
      this.logger.error(formatUnexpected(exception));
    }

    res.status(status).json({ error: { ...body, requestId } } satisfies ApiErrorBody);
  }
}

/**
 * Drizzle wraps every failure in a `DrizzleQueryError` whose message is only the SQL it tried to
 * run — the reason (a pooler timeout, a constraint name, a socket reset) lives in `cause`. Logging
 * the stack alone turned a diagnosable 500 into "Failed query: select …" with no explanation (D69).
 */
export function formatUnexpected(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.stack ?? err.message];
  let cause: unknown = err.cause;
  for (let depth = 0; cause instanceof Error && depth < 4; depth++) {
    const code = (cause as { code?: unknown }).code;
    const tag = typeof code === 'string' ? ` [${code}]` : '';
    parts.push(`caused by${tag}: ${cause.stack ?? cause.message}`);
    cause = cause.cause;
  }
  return parts.join('\n');
}

function codeFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 413:
      return 'FILE_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_FILE_TYPE';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'HTTP_ERROR';
  }
}
