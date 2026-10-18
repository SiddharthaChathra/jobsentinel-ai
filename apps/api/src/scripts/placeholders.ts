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
 * PLACEHOLDER (kept, never deleted, so a re-scan finds them known). A job a user saved or is
 * tracking is listed but never changed.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const db = app.get<Db>(DB);
    const rows = await db.execute<{
      id: string;
      title: string;
      status: string;
      source: string | null;
      kept_by_user: boolean;
    }>(sql`
      select j.id, j.title, j.status,
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
        `  ${h.source ?? '?'} | ${h.status} | ${h.title} | matched "${h.phrase}"${h.kept_by_user ? ' | SAVED/TRACKED: left alone' : ''}`,
      );
    }
    if (!apply) {
      console.warn('\nDry run: nothing changed. Re-run with --apply.');
      return;
    }
    const ids = hits.filter((h) => !h.kept_by_user).map((h) => h.id);
    for (const id of ids) {
      const phrase = hits.find((h) => h.id === id)?.phrase ?? '';
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`update jobs set status = 'PLACEHOLDER', hold_reason = null, updated_at = now() where id = ${id}::uuid`,
        );
        await tx.execute(sql`
          insert into job_events (job_id, type, detail)
          values (${id}::uuid, 'PLACEHOLDER', ${JSON.stringify({ reason: `placeholder posting ("${phrase}")` })}::jsonb)`);
      });
    }
    console.warn(`\nApplied: ${ids.length} marked PLACEHOLDER.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
