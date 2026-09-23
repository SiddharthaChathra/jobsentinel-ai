import type { Logger } from 'pino';

/**
 * Node's default is to kill the process on an unhandled rejection. That is right for a
 * programming error and wrong for a transient socket reset: the Supabase pooler drops idle TLS
 * connections, the error surfaces from `TLSWrap.onStreamRead` with nothing awaiting it, and a
 * long-running process dies for a reason that had nothing to do with the work it was doing.
 *
 * Observed live: the API exited with `read ECONNRESET` while serving normally (D66).
 */
const OPERATIONAL_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
  'CONNECTION_DESTROYED',
]);

/** True for a network/socket failure, as opposed to a bug in our code. */
export function isOperationalError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && OPERATIONAL_CODES.has(code)) return true;
  // postgres.js wraps some socket failures without a code.
  const message = err instanceof Error ? err.message : '';
  return /ECONNRESET|socket hang up|Connection terminated|write EPIPE/i.test(message);
}

/**
 * Keeps a long-running process alive through transient connection errors, while still exiting on
 * anything that looks like a real bug — swallowing everything would hide genuine faults.
 */
export function installProcessGuards(logger: Logger): void {
  process.on('unhandledRejection', (reason: unknown) => {
    if (isOperationalError(reason)) {
      logger.warn({ err: reason }, 'transient connection error; continuing');
      return;
    }
    logger.fatal({ err: reason }, 'unhandled rejection; exiting');
    process.exit(1);
  });

  process.on('uncaughtException', (err: Error) => {
    if (isOperationalError(err)) {
      logger.warn({ err }, 'transient connection error; continuing');
      return;
    }
    logger.fatal({ err }, 'uncaught exception; exiting');
    process.exit(1);
  });
}
