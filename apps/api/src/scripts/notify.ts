import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DigestService } from '../notifications/digest.service';
import { DispatcherService } from '../notifications/dispatcher.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkerModule } from '../worker.module';

/**
 * Runs the alert pipeline once (`pnpm notify [--digest] [--dispatch-only] [--user=<uuid>]`).
 *
 * `enqueue` decides, `dispatch` delivers; both are idempotent, so re-running is safe — the
 * unique index on (user, job, channel, type) is what prevents a second alert (docs 10 §2).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const str = (flag: string) =>
    args.find((x) => x.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  const user = str('user');
  const userIds = user ? [user] : undefined;

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    if (!args.includes('--dispatch-only')) {
      const enqueued = await app
        .get(NotificationsService)
        .enqueuePending({ batch: 200, ...(userIds ? { userIds } : {}) });
      console.warn(`enqueue: ${JSON.stringify(enqueued)}`);
    }
    if (args.includes('--digest')) {
      const digest = await app
        .get(DigestService)
        .sendDue({ ...(userIds ? { userIds } : {}), force: true });
      console.warn(`digest: ${JSON.stringify(digest)}`);
    }
    const sent = await app.get(DispatcherService).dispatchPending({ batch: 50 });
    console.warn(`dispatch: ${JSON.stringify(sent)}`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
