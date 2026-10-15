import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ClassificationService } from '../jobs/classification.service';
import { WorkerModule } from '../worker.module';

/**
 * Re-applies today's classification gates to jobs that are already listed
 * (`pnpm refilter [--apply]`).
 *
 * A job is classified once; one admitted before a gate existed stays listed, scored and alertable.
 * This reuses the pipeline's own decision and preferences rules-only, so it can filter a job but
 * never un-filter one, records the usual FILTERED_OUT event, and skips anything saved or tracked
 * (D86). Dry run by default.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const svc = app.get(ClassificationService);
    const { checked, filtered } = await svc.refilterListed({ apply });

    console.warn(`${filtered.length} of ${checked} listed job(s) fail today's gates.`);
    const byReason = new Map<string, number>();
    for (const f of filtered) {
      const key = f.reason.replace(/\(.*\)/, '(…)');
      byReason.set(key, (byReason.get(key) ?? 0) + 1);
    }
    for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
      console.warn(`  ${n.toString().padStart(4)}  ${reason}`);
    }
    for (const f of filtered.slice(0, 10))
      console.warn(`  · ${f.title.slice(0, 60)} — ${f.reason}`);

    console.warn(
      apply ? `\nfiltered ${filtered.length} job(s).` : '\nDry run. Re-run with --apply to write.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
