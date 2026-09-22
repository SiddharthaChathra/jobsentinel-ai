import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { MatchingService } from '../matching/matching.service';
import { WorkerModule } from '../worker.module';

/**
 * Scores matchable jobs against every onboarded profile
 * (`pnpm match [--batch=N] [--ai=N] [--user=<uuid>]`).
 *
 * Re-running is safe: a job already scored at the user's current profile version is skipped,
 * so this is also how you re-score after a profile edit (which bumps profileVersion).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const num = (flag: string, fallback: number) => {
    const a = args.find((x) => x.startsWith(`--${flag}=`));
    return a ? Number(a.slice(flag.length + 3)) : fallback;
  };
  const str = (flag: string) =>
    args.find((x) => x.startsWith(`--${flag}=`))?.slice(flag.length + 3);
  const batch = num('batch', 200);
  const maxAiCalls = num('ai', 0);
  const user = str('user');

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(MatchingService).matchPending({
      batch,
      maxAiCalls,
      aiTimeBudgetMs: 10 * 60_000,
      ...(user ? { userIds: [user] } : {}),
    });
    console.warn(JSON.stringify(result));
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
