import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@jobsentinel/config';
import { createLogger } from './common/logging/logger';
import { PinoNestLogger } from './common/logging/nest-logger';
import { WorkerLoop } from './scheduler/worker-loop';
import { APP_VERSION } from './version';
import { WorkerModule } from './worker.module';

/**
 * Background worker entrypoint (docs 05 §1, §4).
 * Flags: --once (single tick then exit), --no-telegram (skip long-polling; Phase 9).
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env, 'worker');
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');
  const sourcesArg = [...args].find((a) => a.startsWith('--sources='));
  const sourceIds = sourcesArg
    ? sourcesArg.slice('--sources='.length).split(',').filter(Boolean)
    : undefined;

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: new PinoNestLogger(logger),
  });
  const loop = app.get(WorkerLoop);

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutdown requested');
    loop.stop();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  logger.info({ version: APP_VERSION, once, tickMs: env.WORKER_TICK_MS }, 'worker starting');
  await loop.run({ once, sourceIds, logger });
  await app.close();
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
