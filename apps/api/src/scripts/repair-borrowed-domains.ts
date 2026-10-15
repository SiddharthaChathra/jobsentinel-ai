import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { JobStatus } from '@jobsentinel/types';
import { isSameCompany } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobSources, jobs } from '../common/db/schema';
import { WorkerModule } from '../worker.module';

/**
 * Removes website domains that companies borrowed from a single-company source, and re-queues
 * their jobs for validation (`pnpm repair:domains [--apply]`).
 *
 * The normalizer gave every posting from a single-company source that source's domain, even when
 * the posting named another employer. The Adzuna employer searches are keyword matches, so they
 * return many employers: Brillio was verified against cisco.com and Amazon against cohesity.com,
 * and each job's apply-link check was compared with the wrong domain (D83).
 *
 * The domain, the cached verification and its evidence are cleared, so the next verification
 * starts from what is actually known (no domain). The jobs go back to CLASSIFIED, where the
 * validation upsert overwrites their evidence; matching and notification are idempotent on their
 * natural keys, so a job that was already alerted is never alerted twice.
 *
 * The same run drops cached verifications whose MULTI_SOURCE evidence came from a single provider
 * (two Adzuna searches returning one Adzuna posting), which verified Brillio again even after its
 * borrowed domain was gone; verification now counts providers, not source rows.
 *
 * Trusted companies are never touched: trust is the user's decision. Dry run by default.
 */
const REVALIDATE: JobStatus[] = [
  'VALIDATING',
  'VALID',
  'SUSPICIOUS',
  'NEEDS_REVIEW',
  'REJECTED',
  'MATCHED',
  'AI_PENDING',
  'NOTIFY_PENDING',
  'NOTIFIED',
];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn'],
  });
  try {
    const db = app.get<Db>(DB);
    const sourceCompanies = await db
      .selectDistinct({
        id: companies.id,
        name: companies.name,
        domain: companies.websiteDomain,
      })
      .from(jobSources)
      .innerJoin(companies, eq(companies.id, jobSources.companyId))
      .where(isNotNull(companies.websiteDomain));

    const borrowed: { id: string; name: string; domain: string; owner: string }[] = [];
    for (const owner of sourceCompanies) {
      if (!owner.domain) continue;
      const sharing = await db
        .select({ id: companies.id, name: companies.name })
        .from(companies)
        .where(
          and(
            eq(companies.websiteDomain, owner.domain),
            ne(companies.id, owner.id),
            eq(companies.isTrusted, false),
          ),
        );
      for (const c of sharing) {
        if (!isSameCompany(c.name, owner.name))
          borrowed.push({ ...c, domain: owner.domain, owner: owner.name });
      }
    }

    const ids = borrowed.map((b) => b.id);

    // Cached MULTI_SOURCE evidence counted source rows, so two searches on one provider counted
    // as independent confirmation. Those verifications are dropped and recomputed by provider.
    const singleProvider = (
      await db.execute<{ id: string; name: string }>(sql`
        select c.id, c.name from companies c
        where c.verification_evidence::text like '%MULTI_SOURCE%'
          and c.is_trusted = false
          and (select count(distinct s.adapter) from job_source_mappings m
                 join jobs j on j.id = m.job_id join job_sources s on s.id = m.source_id
                where j.company_id = c.id) < 2`)
    ).filter((c) => !ids.includes(c.id));
    const recheckIds = singleProvider.map((c) => c.id);

    const allIds = [...ids, ...recheckIds];
    const affectedJobs = allIds.length
      ? await db
          .select({ id: jobs.id, status: jobs.status })
          .from(jobs)
          .where(and(inArray(jobs.companyId, allIds), inArray(jobs.status, REVALIDATE)))
      : [];

    console.warn(`${borrowed.length} compan(ies) carry another employer's domain:`);
    for (const b of borrowed.slice(0, 20)) console.warn(`  ${b.name} → ${b.domain} (${b.owner})`);
    if (borrowed.length > 20) console.warn(`  … and ${borrowed.length - 20} more`);
    console.warn(
      `${recheckIds.length} compan(ies) were confirmed "by multiple sources" from one provider:` +
        ` ${singleProvider.map((c) => c.name).join(', ')}`,
    );
    console.warn(`${affectedJobs.length} of their job(s) will be re-validated.`);

    if (!apply) {
      console.warn('\nDry run. Re-run with --apply to clear the domains and re-queue the jobs.');
      return;
    }

    // Batched so a repair never holds one pooled connection for the whole run (D37/D44).
    for (let i = 0; i < ids.length; i += 50) {
      await db
        .update(companies)
        .set({
          websiteDomain: null,
          verificationStatus: 'UNVERIFIED',
          verificationConfidence: null,
          verificationEvidence: [],
          verifiedAt: null,
          updatedAt: new Date(),
        })
        .where(inArray(companies.id, ids.slice(i, i + 50)));
    }
    for (let i = 0; i < recheckIds.length; i += 50) {
      await db
        .update(companies)
        .set({ verificationStatus: 'UNVERIFIED', verifiedAt: null, updatedAt: new Date() })
        .where(inArray(companies.id, recheckIds.slice(i, i + 50)));
    }
    const jobIds = affectedJobs.map((j) => j.id);
    for (let i = 0; i < jobIds.length; i += 50) {
      await db
        .update(jobs)
        .set({ status: 'CLASSIFIED', stageAttempts: 0, stageError: null })
        .where(inArray(jobs.id, jobIds.slice(i, i + 50)));
    }
    console.warn(
      `cleared ${ids.length} domain(s), reset ${recheckIds.length} verification(s) and re-queued` +
        ` ${jobIds.length} job(s) as CLASSIFIED.` +
        ' Run `pnpm validate` to re-validate them.',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
