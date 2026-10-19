import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../common/db/db.module';
import { AuditLogger } from '../system/audit-logger';
import { WorkerModule } from '../worker.module';

type Row = {
  id: string;
  user_email: string;
  title: string;
  status: string;
  updated_at: Date | string;
  last_status_change_at: Date | string | null;
};

/**
 * Undoes audit defect 4 (D129): migration 0013's backfill (`last_status_change_at = updated_at`)
 * fired the `updated_at` trigger, so every existing application got the migration's timestamp
 * and the Applications list (sorted by `updated_at`) lost its order. The backfill copied each
 * row's original `updated_at` into `last_status_change_at` first, so that is the true value.
 *
 * Only rows still carrying the backfill's single shared timestamp are restored; a row edited
 * since then has a newer, genuine `updated_at` and is left alone. `pnpm restore-application-order`
 * shows each user's order before and after; `--apply` writes it with the trigger paused for this
 * one statement.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const db = app.get<Db>(DB);
    // The backfill ran as one statement, so its rows share one transaction timestamp.
    const [stamp] = await db.execute<{ at: Date | string | null; n: number }>(sql`
      select updated_at as at, count(*)::int as n from applications
      group by updated_at having count(*) > 1 order by count(*) desc limit 1`);
    if (!stamp?.at) {
      console.warn('No shared backfill timestamp found: nothing to restore.');
      return;
    }
    const at = new Date(stamp.at).toISOString();
    console.warn(`Backfill timestamp: ${at} (${stamp.n} rows).`);
    const rows = await db.execute<Row>(sql`
      select a.id, u.email as user_email, j.title, a.status::text, a.updated_at, a.last_status_change_at
      from applications a join users u on u.id = a.user_id join jobs j on j.id = a.job_id
      order by u.email, a.updated_at desc`);
    const restored = (r: Row) =>
      new Date(r.updated_at).toISOString() === at && r.last_status_change_at
        ? new Date(r.last_status_change_at)
        : new Date(r.updated_at);
    const users = [...new Set(rows.map((r) => r.user_email))];
    for (const email of users) {
      const mine = rows.filter((r) => r.user_email === email);
      const before = [...mine].sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at));
      const after = [...mine].sort((a, b) => +restored(b) - +restored(a));
      console.warn(`\n${email.replace(/^(.{3}).*(@.*)$/, '$1…$2')} — ${mine.length} applications`);
      console.warn('  before (as the list shows it now)        | after (restored)');
      for (let i = 0; i < mine.length; i++) {
        const b = before[i]!;
        const a = after[i]!;
        const fmt = (r: Row, d: Date) =>
          `${d.toISOString().slice(0, 16).replace('T', ' ')} ${r.status.padEnd(10)} ${r.title.slice(0, 28)}`;
        console.warn(`  ${fmt(b, new Date(b.updated_at)).padEnd(52)} | ${fmt(a, restored(a))}`);
      }
    }
    const toFix = rows.filter(
      (r) => new Date(r.updated_at).toISOString() === at && r.last_status_change_at,
    );
    console.warn(`\nRows to restore: ${toFix.length}.`);
    if (!apply) {
      console.warn('Dry run: nothing changed. Re-run with --apply.');
      return;
    }
    await db.transaction(async (tx) => {
      // Paused for this statement only, so restoring the timestamp does not overwrite it again.
      await tx.execute(sql`alter table applications disable trigger applications_set_updated_at`);
      await tx.execute(sql`
        update applications set updated_at = last_status_change_at
        where date_trunc('milliseconds', updated_at) = ${at}::timestamptz
          and last_status_change_at is not null`);
      await tx.execute(sql`alter table applications enable trigger applications_set_updated_at`);
    });
    await app.get(AuditLogger).event('HOUSEKEEPING', 'application order restored (D129)', {
      rows: toFix.length,
      backfillTimestamp: at,
    });
    console.warn('Applied.');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
