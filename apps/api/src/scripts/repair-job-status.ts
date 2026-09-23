import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../common/db/db.module';
import { jobs } from '../common/db/schema';
import { WorkerModule } from '../worker.module';

/**
 * Repairs jobs parked in `REJECTED` that the validator never rejected
 * (`pnpm --filter @jobsentinel/api exec node dist/scripts/repair-job-status.js [--apply]`).
 *
 * `REJECTED` is a *validation* verdict — "this posting is not legitimate". A job that is merely
 * outside the user's preferences belongs in `FILTERED_OUT`, which is the only state
 * `ClassificationService.requeueFiltered()` can bring back. An ad-hoc backfill wrote 370 valid
 * postings straight to `REJECTED`, putting them permanently beyond a preferences change (D74).
 *
 * Dry run by default: it prints what it would change and touches nothing without `--apply`.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get<Db>(DB);
    const stuck = await db
      .select({ id: jobs.id, title: jobs.title, country: jobs.locationCountry })
      .from(jobs)
      .where(
        and(eq(jobs.status, 'REJECTED'), inArray(jobs.validationStatus, ['VALID', 'NEEDS_REVIEW'])),
      );

    console.warn(`${stuck.length} job(s) are REJECTED although validation did not reject them.`);
    for (const row of stuck.slice(0, 10)) {
      console.warn(`  ${row.country ?? '(no country)'} — ${row.title.slice(0, 60)}`);
    }
    if (stuck.length > 10) console.warn(`  … and ${stuck.length - 10} more`);

    if (!apply) {
      console.warn('\nDry run. Re-run with --apply to move them to FILTERED_OUT.');
      return;
    }

    // Batched, so a large repair never holds one pooled connection for the whole run (D37/D44).
    let moved = 0;
    for (let i = 0; i < stuck.length; i += 50) {
      const ids = stuck.slice(i, i + 50).map((r) => r.id);
      await db.update(jobs).set({ status: 'FILTERED_OUT' }).where(inArray(jobs.id, ids));
      moved += ids.length;
    }
    console.warn(
      `moved ${moved} job(s) to FILTERED_OUT (recoverable via \`pnpm classify --requeue\`)`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
