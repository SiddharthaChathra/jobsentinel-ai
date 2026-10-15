import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { normalizeLocation } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { jobSourceMappings, jobSources, jobs } from '../common/db/schema';
import { adzunaLocationText } from '../sources/adapters/adzuna.adapter';
import { WorkerModule } from '../worker.module';

/**
 * Recovers the country of Adzuna jobs from the stored payload, and re-queues the ones the India
 * gate dropped because of it (`pnpm repair:adzuna-locations [--apply]`).
 *
 * The adapter used to keep only Adzuna's `display_name` ("Chandgad, Kolhapur"), which names the
 * town but not the country, so the classification gate filtered Graduate Engineer Trainee roles
 * from the India board as "outside India (unknown)". The country was in `location.area[0]` all
 * along and the raw payload is stored, so nothing has to be fetched again (D84).
 *
 * Location fields are rewritten for every such job; only FILTERED_OUT ones go back to DISCOVERED,
 * where classification decides them again on every rule, not just location. Dry run by default.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get<Db>(DB);
    const rows = await db
      .select({
        id: jobs.id,
        title: jobs.title,
        status: jobs.status,
        isRemote: jobs.isRemote,
        raw: jobSourceMappings.rawPayload,
      })
      .from(jobs)
      .innerJoin(jobSourceMappings, eq(jobSourceMappings.jobId, jobs.id))
      .innerJoin(jobSources, eq(jobSources.id, jobSourceMappings.sourceId))
      .where(and(isNull(jobs.locationCountry), eq(jobSources.adapter, 'adzuna')));

    // A job can be mapped from several Adzuna searches; the first payload that resolves wins.
    const fixes = new Map<
      string,
      { text: string; city: string | null; country: string; requeue: boolean; title: string }
    >();
    for (const row of rows) {
      if (fixes.has(row.id)) continue;
      const location = (row.raw as { location?: { display_name?: string; area?: string[] } })
        ?.location;
      const text = adzunaLocationText(location);
      if (!text) continue;
      const loc = normalizeLocation(text, row.isRemote);
      if (!loc.country) continue;
      fixes.set(row.id, {
        text,
        city: loc.city,
        country: loc.country,
        requeue: row.status === 'FILTERED_OUT',
        title: row.title,
      });
    }

    const requeue = [...fixes].filter(([, f]) => f.requeue).map(([id]) => id);
    console.warn(
      `${fixes.size} Adzuna job(s) now resolve to a country; ${requeue.length} re-queued.`,
    );
    for (const f of [...fixes.values()].slice(0, 15)) {
      console.warn(`  ${f.country} — ${f.text} — ${f.title.slice(0, 50)}${f.requeue ? ' ↺' : ''}`);
    }

    if (!apply) {
      console.warn('\nDry run. Re-run with --apply to write them.');
      return;
    }

    // Few rows, but still one statement each rather than one long transaction (D37).
    for (const [id, f] of fixes) {
      await db
        .update(jobs)
        .set({ locationText: f.text, locationCity: f.city, locationCountry: f.country })
        .where(eq(jobs.id, id));
    }
    for (let i = 0; i < requeue.length; i += 50) {
      await db
        .update(jobs)
        .set({ status: 'DISCOVERED', stageAttempts: 0, stageError: null })
        .where(inArray(jobs.id, requeue.slice(i, i + 50)));
    }
    console.warn(
      `updated ${fixes.size} job(s). Run \`pnpm classify\` then \`pnpm validate\` to process them.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
