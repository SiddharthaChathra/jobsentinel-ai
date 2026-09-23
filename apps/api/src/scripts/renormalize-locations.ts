import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { isNull, inArray, and, isNotNull } from 'drizzle-orm';
import { normalizeLocation } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { jobs } from '../common/db/schema';
import { WorkerModule } from '../worker.module';

/**
 * Re-runs location normalization over jobs whose country never resolved
 * (`pnpm --filter @jobsentinel/api exec node dist/scripts/renormalize-locations.js [--apply]`).
 *
 * Normalization happens once at ingest, so widening the city/state tables does nothing for jobs
 * already stored — and a job with no country is treated as foreign by the classification gate.
 * Adding the Indian states recovered 15 real postings in tier-2/tier-3 cities (D73).
 *
 * Dry run by default.
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
        text: jobs.locationText,
        isRemote: jobs.isRemote,
        title: jobs.title,
      })
      .from(jobs)
      .where(and(isNull(jobs.locationCountry), isNotNull(jobs.locationText)));

    const changed = rows.flatMap((row) => {
      const next = normalizeLocation(row.text, row.isRemote);
      return next.country ? [{ ...row, city: next.city, country: next.country }] : [];
    });

    console.warn(`${changed.length} of ${rows.length} job(s) now resolve to a country.`);
    for (const row of changed.slice(0, 15)) {
      console.warn(`  ${row.country} — ${row.text ?? ''} — ${row.title.slice(0, 50)}`);
    }

    if (!apply) {
      console.warn('\nDry run. Re-run with --apply to write them.');
      return;
    }

    // One update per distinct (city, country) pair keeps this to a handful of statements rather
    // than one per row over the pooler (D37).
    const byPlace = new Map<string, { city: string | null; country: string; ids: string[] }>();
    for (const row of changed) {
      const key = `${row.city ?? ''}|${row.country}`;
      const entry = byPlace.get(key) ?? { city: row.city, country: row.country, ids: [] };
      entry.ids.push(row.id);
      byPlace.set(key, entry);
    }
    for (const { city, country, ids } of byPlace.values()) {
      for (let i = 0; i < ids.length; i += 50) {
        await db
          .update(jobs)
          .set({ locationCity: city, locationCountry: country })
          .where(inArray(jobs.id, ids.slice(i, i + 50)));
      }
    }
    console.warn(
      `updated ${changed.length} job(s). Run \`pnpm classify --requeue\` to re-evaluate them.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
