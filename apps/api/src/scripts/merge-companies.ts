import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { CompanyFresherService } from '../sources/company-fresher.service';
import { AuditLogger } from '../system/audit-logger';
import { WorkerModule } from '../worker.module';

type CompanyRow = {
  id: string;
  name: string;
  normalized_name: string;
  website_domain: string | null;
  verification_status: string;
  is_trusted: boolean;
  is_blocked: boolean;
  jobs: number;
  sources: number;
};

const RANK: Record<string, number> = { VERIFIED: 2, UNVERIFIED: 1 };

/**
 * Brings stored company keys in line with `normalizeCompanyName` after D128 (a board's own name,
 * "HackerRank Careers", now keys as "hackerrank"). `pnpm merge-companies` lists the plan and
 * changes nothing; `--apply` carries it out, one company per transaction:
 *
 * - RENAME: no row has the new key yet — only `normalized_name` changes.
 * - MERGE: a row already has it — the duplicate's jobs and sources move to that row, which keeps
 *   the better verification and either row's trust and domain; the empty duplicate is deleted.
 * - SKIP: either row is blocked or suspicious — left for the owner; never merged automatically.
 *
 * Job dedupe keys are not rewritten: re-scans find jobs by (source, external id), and a new key
 * could collide with an unrelated job.
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['error'] });
  try {
    const db = app.get<Db>(DB);
    const rows = await db.execute<CompanyRow>(sql`
      select c.id, c.name, c.normalized_name, c.website_domain, c.verification_status::text,
        c.is_trusted, c.is_blocked,
        (select count(*)::int from jobs j where j.company_id = c.id) as jobs,
        (select count(*)::int from job_sources s where s.company_id = c.id) as sources
      from companies c order by c.created_at`);
    const byKey = new Map(rows.map((r) => [r.normalized_name, r]));
    const plan: {
      action: 'RENAME' | 'MERGE' | 'SKIP';
      from: CompanyRow;
      to?: CompanyRow;
      key: string;
      why?: string;
    }[] = [];
    for (const r of rows) {
      const key = normalizeCompanyName(r.name);
      if (key === r.normalized_name) continue;
      const target = byKey.get(key);
      if (!target) {
        plan.push({ action: 'RENAME', from: r, key });
        byKey.delete(r.normalized_name);
        byKey.set(key, { ...r, normalized_name: key });
        continue;
      }
      const risky = [r, target].find(
        (x) =>
          x.is_blocked ||
          x.verification_status === 'SUSPICIOUS' ||
          x.verification_status === 'BLOCKED',
      );
      if (risky) {
        plan.push({
          action: 'SKIP',
          from: r,
          to: target,
          key,
          why: `${risky.name} is blocked or suspicious`,
        });
        continue;
      }
      plan.push({ action: 'MERGE', from: r, to: target, key });
    }

    console.warn(`Companies: ${rows.length}. Changes: ${plan.length}.`);
    for (const p of plan) {
      const into = p.to
        ? ` → into "${p.to.name}" (${p.to.jobs} jobs, ${p.to.sources} sources)`
        : '';
      console.warn(
        `  ${p.action} "${p.from.name}" [${p.from.normalized_name} → ${p.key}] (${p.from.jobs} jobs, ${p.from.sources} sources)${into}${p.why ? ` — ${p.why}` : ''}`,
      );
    }
    if (!apply) {
      console.warn('\nDry run: nothing changed. Re-run with --apply.');
      return;
    }

    for (const p of plan) {
      if (p.action === 'SKIP') continue;
      await db.transaction(async (tx) => {
        if (p.action === 'RENAME') {
          await tx.execute(
            sql`update companies set normalized_name = ${p.key}, updated_at = now() where id = ${p.from.id}::uuid`,
          );
          return;
        }
        const from = p.from;
        const to = p.to!;
        const better =
          (RANK[from.verification_status] ?? 0) > (RANK[to.verification_status] ?? 0)
            ? from.verification_status
            : to.verification_status;
        await tx.execute(
          sql`update jobs set company_id = ${to.id}::uuid, updated_at = now() where company_id = ${from.id}::uuid`,
        );
        await tx.execute(
          sql`update job_sources set company_id = ${to.id}::uuid, updated_at = now() where company_id = ${from.id}::uuid`,
        );
        await tx.execute(sql`
          update companies set
            website_domain = coalesce(website_domain, ${from.website_domain}),
            verification_status = ${better}::company_verification,
            is_trusted = is_trusted or ${from.is_trusted},
            updated_at = now()
          where id = ${to.id}::uuid`);
        await tx.execute(sql`delete from companies where id = ${from.id}::uuid`);
      });
    }
    const audit = app.get(AuditLogger);
    await audit.event('HOUSEKEEPING', 'company keys normalised (D128)', {
      renamed: plan.filter((p) => p.action === 'RENAME').length,
      merged: plan.filter((p) => p.action === 'MERGE').map((p) => `${p.from.name} → ${p.to!.name}`),
      skipped: plan.filter((p) => p.action === 'SKIP').map((p) => p.from.name),
    });
    await app.get(CompanyFresherService).recompute();
    console.warn(`\nApplied. Fresher scores recomputed.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
