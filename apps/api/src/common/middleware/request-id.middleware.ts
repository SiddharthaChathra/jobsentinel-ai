import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Attaches a request id (honouring an incoming X-Request-Id) for logs and error envelopes. */
export function requestIdMiddleware(
  req: Request & { requestId?: string },
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-request-id');
  const id = incoming && incoming.length <= 64 ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
