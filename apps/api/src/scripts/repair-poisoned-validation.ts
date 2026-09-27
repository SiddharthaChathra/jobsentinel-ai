import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../common/db/db.module';
import { jobValidation, jobs } from '../common/db/schema';
import { WorkerModule } from '../worker.module';

/**
 * Re-queues jobs whose validation evidence was written by the test suite's fake HTTP client
 * (`node dist/scripts/repair-poisoned-validation.js [--apply]`).
 *
 * The e2e validation spec ran eight unscoped `validatePending({ batch: 5 })` calls against the
 * shared live database, so each run validated real postings with `FakeHttpClient` and recorded its
 * "unscripted request: …" error as a PAGE_UNREACHABLE check. 256 of 731 validation rows carried
 * that fabricated evidence and 255 sat in NEEDS_REVIEW because of it, which is what starved the
 * job list. `validatePending` now takes a `jobIds` scope so it cannot recur (D77).
 *
 * Nothing is deleted: the validation write upserts on `job_id`, so putting the job back to
 * CLASSIFIED is enough for a real probe to overwrite the fabricated row.
 *
 * Dry run by default.
 */
const FAKE_MARKER = '%unscripted request%';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get<Db>(DB);
    const poisoned = await db
      .select({ jobId: jobValidation.jobId, status: jobValidation.status })
      .from(jobValidation)
      .where(sql`${jobValidation.evidence}::text like ${FAKE_MARKER}`);

    console.warn(`${poisoned.length} validation row(s) carry the test fake's error as evidence.`);
    const byStatus = new Map<string, number>();
    for (const row of poisoned) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    for (const [status, count] of byStatus) console.warn(`  ${status}: ${count}`);

    if (!apply) {
      console.warn('\nDry run. Re-run with --apply to requeue them for a real re-validation.');
      return;
    }

    // Batched so a large repair never holds one pooled connection for the whole run (D37/D44).
    const ids = poisoned.map((r) => r.jobId);
    for (let i = 0; i < ids.length; i += 50) {
      await db
        .update(jobs)
        .set({ status: 'CLASSIFIED', stageAttempts: 0, stageError: null })
        .where(inArray(jobs.id, ids.slice(i, i + 50)));
    }
    console.warn(
      `requeued ${ids.length} job(s) as CLASSIFIED. Run \`pnpm validate\` (real HTTP client) to` +
        ` re-validate them; the upsert overwrites the fabricated evidence.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
