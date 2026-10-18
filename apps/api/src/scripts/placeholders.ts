import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { placeholderMatch } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { WorkerModule } from '../worker.module';

/**
 * Placeholder postings already in the database (D117): `pnpm placeholders` lists every job the
 * rule would flag, across all sources and statuses, and changes nothing. `--apply` marks them
 * PLACEHOLDER (kept, never deleted, so a re-scan finds them known), recording each job's previous
 * status and hold reason in its PLACEHOLDER event. A job a user saved or is tracking is listed but
 * never changed.
 *
 * `--restore` is the rollback (docs/deployment.md "Placeholder filter: rollback"): every PLACEHOLDER job goes
 * back to the status recorded when it was marked; one the classifier marked (no recorded status)
 * is re-queued for classification. Turn PLACEHOLDER_FILTER_ENABLED off first, or the classifier
 * marks those again.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const restore = process.argv.includes('--restore');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const db = app.get<Db>(DB);
    if (restore) {
      await restoreAll(db, process.argv.includes('--dry-run'));
      return;
    }
    const rows = await db.execute<{
      id: string;
      title: string;
      status: string;
      hold_reason: string | null;
      source: string | null;
      kept_by_user: boolean;
    }>(sql`
      select j.id, j.title, j.status, j.hold_reason,
        (select s.name from job_source_mappings m join job_sources s on s.id = m.source_id
          where m.job_id = j.id order by m.is_primary desc limit 1) as source,
        (exists (select 1 from saved_jobs x where x.job_id = j.id)
          or exists (select 1 from applications a where a.job_id = j.id)) as kept_by_user
      from jobs j where j.status <> 'PLACEHOLDER'`);
    const hits = rows
      .map((r) => ({ ...r, phrase: placeholderMatch(r.title) }))
      .filter((r) => r.phrase !== null)
      .sort((a, b) => (a.source ?? '').localeCompare(b.source ?? ''));
    console.warn(`Scanned ${rows.length} jobs; the rule flags ${hits.length}:`);
    for (const h of hits) {
      console.warn(
        `  ${h.id} | ${h.source ?? '?'} | ${h.status} | ${h.title} | matched "${h.phrase}"${h.kept_by_user ? ' | SAVED/TRACKED: left alone' : ''}`,
      );
    }
    if (!apply) {
      console.warn('\nDry run: nothing changed. Re-run with --apply.');
      return;
    }
    let marked = 0;
    for (const h of hits.filter((x) => !x.kept_by_user)) {
      await db.transaction(async (tx) => {
        // Guarded on the status we listed, so a job the worker moved meanwhile is left alone.
        const done = await tx.execute(sql`
          update jobs set status = 'PLACEHOLDER', hold_reason = null, updated_at = now()
          where id = ${h.id}::uuid and status = ${h.status}::job_status returning id`);
        if (done.length === 0) return;
        marked += 1;
        await tx.execute(sql`
          insert into job_events (job_id, type, detail)
          values (${h.id}::uuid, 'PLACEHOLDER', ${JSON.stringify({
            reason: `placeholder posting ("${h.phrase}")`,
            previousStatus: h.status,
            previousHoldReason: h.hold_reason,
          })}::jsonb)`);
      });
    }
    console.warn(`\nApplied: ${marked} marked PLACEHOLDER.`);
  } finally {
    await app.close();
  }
}

async function restoreAll(db: Db, dryRun: boolean): Promise<void> {
  const rows = await db.execute<{
    id: string;
    title: string;
    previous_status: string | null;
    previous_hold_reason: string | null;
  }>(sql`
    select j.id, j.title,
      e.detail->>'previousStatus' as previous_status,
      e.detail->>'previousHoldReason' as previous_hold_reason
    from jobs j
    left join lateral (
      select detail from job_events
      where job_id = j.id and type = 'PLACEHOLDER' order by created_at desc limit 1
    ) e on true
    where j.status = 'PLACEHOLDER'`);
  console.warn(`${rows.length} PLACEHOLDER jobs:`);
  for (const r of rows) {
    console.warn(`  ${r.id} | ${r.title} -> ${r.previous_status ?? 'DISCOVERED (re-classify)'}`);
  }
  if (dryRun) {
    console.warn('\nDry run: nothing changed.');
    return;
  }
  for (const r of rows) {
    await db.transaction(async (tx) => {
      if (r.previous_status) {
        await tx.execute(sql`
          update jobs set status = ${r.previous_status}::job_status,
            hold_reason = ${r.previous_hold_reason}, updated_at = now()
          where id = ${r.id}::uuid and status = 'PLACEHOLDER'`);
      } else {
        await tx.execute(sql`
          update jobs set status = 'DISCOVERED', stage_attempts = 0, stage_error = null,
            updated_at = now()
          where id = ${r.id}::uuid and status = 'PLACEHOLDER'`);
      }
      await tx.execute(sql`
        insert into job_events (job_id, type, detail)
        values (${r.id}::uuid, 'PLACEHOLDER_RESTORED', ${JSON.stringify({
          restoredTo: r.previous_status ?? 'DISCOVERED',
        })}::jsonb)`);
    });
  }
  console.warn(`\nRestored: ${rows.length}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
