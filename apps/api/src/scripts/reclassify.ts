import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ClassificationService, type ClassifyResult } from '../jobs/classification.service';
import { WorkerModule } from '../worker.module';

/**
 * Classifies the whole backlog in one go (`pnpm classify [--requeue] [--ai=N]`).
 * Use after a preferences change (`--requeue` moves CLASSIFIED/FILTERED_OUT jobs back to
 * DISCOVERED) or to drain a backlog the worker would otherwise chew through over many ticks.
 */
async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const requeue = args.has('--requeue');
  const aiArg = [...args].find((a) => a.startsWith('--ai='));
  const maxAiCalls = aiArg ? Number(aiArg.slice(5)) : 0;

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const svc = app.get(ClassificationService);
    if (requeue) {
      let requeued = 0;
      for (;;) {
        const n = await svc.requeueFiltered(1000);
        requeued += n;
        if (n === 0) break;
      }
      console.warn(`requeued ${requeued} jobs`);
    }
    const totals: ClassifyResult = {
      processed: 0,
      classified: 0,
      filteredOut: 0,
      aiUsed: 0,
      aiUnavailable: 0,
      deferred: 0,
    };
    const startedAt = Date.now();
    for (;;) {
      // One AI call takes ~4.5 s at the free tier's pacing; give the batch time for all of them.
      const r = await svc.classifyPending({
        batch: 200,
        maxAiCalls,
        aiTimeBudgetMs: Math.max(60_000, maxAiCalls * 6_000),
      });
      if (r.processed === r.deferred) break; // only jobs still waiting for an AI verdict remain
      if (r.processed === 0) break;
      for (const k of Object.keys(totals) as (keyof ClassifyResult)[]) totals[k] += r[k];
      process.stdout.write(
        `\r${totals.processed} processed · ${totals.aiUsed} AI calls · ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
      );
    }
    console.warn(`\n${JSON.stringify(totals)}`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
