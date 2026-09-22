import pino, { type Logger } from 'pino';
import type { Env } from '@jobsentinel/config';

/** Fields that must never reach logs (docs 11). Extend as new secrets appear. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.extractedText',
  '*.extracted_text',
];

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>, name: string): Logger {
  const pretty = env.NODE_ENV !== 'production';
  return pino({
    name,
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
