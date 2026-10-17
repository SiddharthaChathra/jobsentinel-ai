import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { classifyPostingType } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { WorkerModule } from '../worker.module';

/**
 * One-off backfill for D110 and D114 (`pnpm backfill:holds [--apply]`). Without `--apply` it only
 * prints what it would change.
 *
 * 1. Jobs classification held before D110 (status NEEDS_REVIEW, never validated, no hold_reason)
 *    get their hold reason and go to validation, like every job held from now on.
 * 2. Jobs filtered in the last 60 days only because their experience was unknown are classified
 *    again: under the owner's R2 decision they are held for review, not filtered. They re-enter at
 *    the last allowed wait, so they are held at once if the AI still cannot place them; India,
 *    batch and recency gates apply as for any job.
 *    Also jobs filtered as "asks for N+ years" with N above 15: company history the parser read
 *    as a requirement before D116.
 * 3. Active jobs from the last 60 days get their posting type.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const db = app.get<Db>(DB);
    const recent = sql`coalesce(j.posted_at, j.first_seen_at) >= now() - interval '60 days'`;

    const legacy = await db.execute<{ id: string; reason: string }>(sql`
      select j.id, e.reason from jobs j
      cross join lateral (
        select ev.detail->>'reason' as reason from job_events ev
        where ev.job_id = j.id and ev.type = 'HELD' order by ev.created_at desc limit 1) e
      where j.status = 'NEEDS_REVIEW' and j.hold_reason is null
        and (j.validation_status is null or j.validation_status = 'PENDING')
        and e.reason is not null`);
    console.warn(`1. held before D110, to validate with their reason: ${legacy.length}`);

    const unknown = await db.execute<{ id: string; title: string }>(sql`
      select j.id, j.title from jobs j
      cross join lateral (
        select ev.detail->>'reason' as reason from job_events ev
        where ev.job_id = j.id and ev.type = 'FILTERED_OUT' order by ev.created_at desc limit 1) e
      where j.status = 'FILTERED_OUT' and ${recent}
        and (e.reason like 'experience unknown%'
          -- D116: a "requirement" above 15 years was company history misread as one
          or e.reason ~ '^asks for (1[6-9]|[2-9][0-9])[+] years')`);
    console.warn(
      `2. filtered for unknown experience, or for a misread 16+ years, to classify again: ${unknown.length}`,
    );
    for (const r of unknown.slice(0, 15)) console.warn(`     ${r.title}`);

    const active = await db.execute<{
      id: string;
      title: string;
      description: string;
      posting_type: string;
    }>(sql`
      select j.id, j.title, j.description, j.posting_type from jobs j
      where j.status not in ('FILTERED_OUT', 'EXPIRED', 'REJECTED') and ${recent}`);
    const typed = active
      .map((r) => ({ id: r.id, title: r.title, from: r.posting_type, to: classifyPostingType(r) }))
      .filter((r) => r.to !== r.from);
    console.warn(`3. posting type to set: ${typed.length}`);
    for (const r of typed.slice(0, 15)) console.warn(`     ${r.to}: ${r.title}`);

    if (!apply) {
      console.warn('\nDry run: nothing changed. Re-run with --apply.');
      return;
    }
    for (const r of legacy) {
      await db.execute(sql`
        update jobs set hold_reason = ${r.reason}, status = 'CLASSIFIED', stage_attempts = 0,
          updated_at = now() where id = ${r.id}::uuid and status = 'NEEDS_REVIEW'`);
    }
    const ids = unknown.map((r) => r.id);
    for (let i = 0; i < ids.length; i += 50) {
      await db.execute(sql`
        update jobs set status = 'DISCOVERED', stage_attempts = 4, stage_error = null,
          updated_at = now()
        where status = 'FILTERED_OUT' and id in (${sql.join(
          ids.slice(i, i + 50).map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`);
    }
    for (const r of typed) {
      await db.execute(
        sql`update jobs set posting_type = ${r.to}::posting_type where id = ${r.id}::uuid`,
      );
    }
    console.warn(
      `\nApplied: ${legacy.length} sent to validation, ${ids.length} re-queued, ${typed.length} typed.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
