import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { hammingDistance, simhashFromSigned, titleSimilarity } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { jobEvents, jobSourceMappings, jobs } from '../common/db/schema';
import type { RawJob } from '../sources/job-source';
import type { NormalizedJob } from './normalizer';

export type DedupeOutcome = 'NEW' | 'UPDATED' | 'UNCHANGED' | 'ATTACHED';
export type MatchedBy = 'MAPPING' | 'URL' | 'DEDUPE_KEY' | 'SIMHASH' | 'BATCH';
export interface DedupeResult {
  externalId: string;
  jobId: string;
  outcome: DedupeOutcome;
  matchedBy?: MatchedBy;
}

export interface DedupeItem {
  job: NormalizedJob;
  companyId: string;
  raw: RawJob;
}

const SIMHASH_MAX_DISTANCE = 6;
const TITLE_MIN_SIMILARITY = 0.6;
const RAW_PAYLOAD_MAX_BYTES = 64 * 1024;

type KnownMapping = { jobId: string; mappingId: string; isPrimary: boolean };
type JobProbe = { id: string; contentHash: string | null; applicationUrl: string | null };
type Candidate = { id: string; title: string; simhash: bigint | null; sourceIds: string[] };

/**
 * Per-scan state so a batch of N jobs costs a handful of round-trips instead of ~8·N
 * (the Supabase pooler is ~100 ms away; Rubrik's 83 jobs timed out with per-row lookups).
 */
export class DedupeContext {
  constructor(
    readonly sourceId: string,
    readonly known: Map<string, KnownMapping>,
    readonly companyCandidates: Map<string, Candidate[]>,
  ) {}
}

/**
 * Merges normalized jobs into the canonical `jobs` table (docs 06 §6). Match order:
 * existing mapping → application URL → dedupe key → SimHash+title within the same company.
 * Everything is keyed by (source_id, external_id), so re-scans and crashes never duplicate.
 */
@Injectable()
export class DedupeService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async createContext(sourceId: string): Promise<DedupeContext> {
    const rows = await this.db
      .select({
        externalId: jobSourceMappings.externalId,
        jobId: jobSourceMappings.jobId,
        mappingId: jobSourceMappings.id,
        isPrimary: jobSourceMappings.isPrimary,
      })
      .from(jobSourceMappings)
      .where(eq(jobSourceMappings.sourceId, sourceId));
    return new DedupeContext(
      sourceId,
      new Map(
        rows.map((r) => [
          r.externalId,
          { jobId: r.jobId, mappingId: r.mappingId, isPrimary: r.isPrimary },
        ]),
      ),
      new Map(),
    );
  }

  /** One transaction per batch: a failure leaves no half-written jobs (docs 05 §6). */
  upsertBatch(items: DedupeItem[], ctx: DedupeContext): Promise<DedupeResult[]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.db.transaction((tx) => this.upsertBatchIn(tx as unknown as Db, items, ctx));
  }

  private async upsertBatchIn(
    db: Db,
    items: DedupeItem[],
    ctx: DedupeContext,
  ): Promise<DedupeResult[]> {
    const now = new Date();
    const results: DedupeResult[] = [];

    // ── 1. Known from this source: refresh, detect content changes ─────────────
    const knownItems = items.filter((i) => ctx.known.has(i.raw.externalId));
    const unknownItems = items.filter((i) => !ctx.known.has(i.raw.externalId));
    if (knownItems.length > 0) {
      const jobIds = knownItems.map((i) => ctx.known.get(i.raw.externalId)!.jobId);
      const probes = await db
        .select({ id: jobs.id, contentHash: jobs.contentHash, applicationUrl: jobs.applicationUrl })
        .from(jobs)
        .where(inArray(jobs.id, jobIds));
      const byId = new Map(probes.map((p) => [p.id, p]));
      const unchangedIds: string[] = [];
      for (const item of knownItems) {
        const { jobId, isPrimary } = ctx.known.get(item.raw.externalId)!;
        const probe = byId.get(jobId);
        // Only the primary mapping owns the canonical content; secondary postings just refresh last_seen.
        if (!probe || !isPrimary || probe.contentHash === item.job.contentHash) {
          unchangedIds.push(jobId);
          results.push({
            externalId: item.raw.externalId,
            jobId,
            outcome: 'UNCHANGED',
            matchedBy: 'MAPPING',
          });
          continue;
        }
        await this.applyContentUpdate(db, jobId, item.job, probe, now);
        results.push({
          externalId: item.raw.externalId,
          jobId,
          outcome: 'UPDATED',
          matchedBy: 'MAPPING',
        });
      }
      const mappingIds = knownItems
        .map((i) => ctx.known.get(i.raw.externalId)!.mappingId)
        .filter(Boolean);
      if (mappingIds.length > 0)
        await db
          .update(jobSourceMappings)
          .set({ lastSeenAt: now })
          .where(inArray(jobSourceMappings.id, mappingIds));
      if (unchangedIds.length > 0)
        await db.update(jobs).set({ lastSeenAt: now }).where(inArray(jobs.id, unchangedIds));
    }
    if (unknownItems.length === 0) return results;

    // ── 2–4. Unknown here: does another source already have it? ──────────────
    const urls = [
      ...new Set(
        unknownItems.map((i) => i.job.applicationUrl).filter((u): u is string => Boolean(u)),
      ),
    ];
    const keys = [...new Set(unknownItems.map((i) => i.job.dedupeKey))];
    const existing = await this.db
      .select({
        id: jobs.id,
        applicationUrl: jobs.applicationUrl,
        finalApplicationUrl: jobs.finalApplicationUrl,
        dedupeKey: jobs.dedupeKey,
      })
      .from(jobs)
      .where(
        or(
          urls.length ? inArray(jobs.applicationUrl, urls) : sql`false`,
          urls.length ? inArray(jobs.finalApplicationUrl, urls) : sql`false`,
          inArray(jobs.dedupeKey, keys),
        ),
      );
    const byUrl = new Map<string, string>();
    const byKey = new Map<string, string>();
    for (const e of existing) {
      if (e.applicationUrl) byUrl.set(e.applicationUrl, e.id);
      if (e.finalApplicationUrl) byUrl.set(e.finalApplicationUrl, e.id);
      byKey.set(e.dedupeKey, e.id);
    }

    const toAttach: { item: DedupeItem; jobId: string; matchedBy: MatchedBy }[] = [];
    const toInsert: DedupeItem[] = [];
    // within-batch duplicates (same key/url twice in one scan) attach to the first one inserted
    const batchByKey = new Map<string, number>();
    const batchByUrl = new Map<string, number>();

    for (const item of unknownItems) {
      const url = item.job.applicationUrl;
      const matched =
        (url && byUrl.get(url) && { id: byUrl.get(url)!, by: 'URL' as const }) ||
        (byKey.get(item.job.dedupeKey) && {
          id: byKey.get(item.job.dedupeKey)!,
          by: 'DEDUPE_KEY' as const,
        });
      if (matched) {
        toAttach.push({ item, jobId: matched.id, matchedBy: matched.by });
        continue;
      }
      const fuzzy = await this.findFuzzy(db, item, ctx);
      if (fuzzy) {
        toAttach.push({ item, jobId: fuzzy, matchedBy: 'SIMHASH' });
        continue;
      }
      const dupIndex = (url && batchByUrl.get(url)) ?? batchByKey.get(item.job.dedupeKey);
      if (dupIndex !== undefined) {
        toAttach.push({ item, jobId: `#${dupIndex}`, matchedBy: 'BATCH' });
        continue;
      }
      batchByKey.set(item.job.dedupeKey, toInsert.length);
      if (url) batchByUrl.set(url, toInsert.length);
      toInsert.push(item);
    }

    // ── 5. Bulk insert genuinely new jobs (+ mappings + events) ───────────────
    const insertedIds: string[] = [];
    if (toInsert.length > 0) {
      const inserted = await this.db
        .insert(jobs)
        .values(toInsert.map((i) => toInsertRow(i, now)))
        .returning({ id: jobs.id });
      insertedIds.push(...inserted.map((r) => r.id));
      await this.db
        .insert(jobSourceMappings)
        .values(
          toInsert.map((i, idx) => ({
            jobId: insertedIds[idx]!,
            sourceId: ctx.sourceId,
            externalId: i.raw.externalId,
            sourceUrl: i.job.sourceUrl,
            rawPayload: boundedPayload(i.raw.raw),
            isPrimary: true,
            firstSeenAt: now,
            lastSeenAt: now,
          })),
        )
        .onConflictDoNothing();
      await db.insert(jobEvents).values(
        insertedIds.map((jobId) => ({
          jobId,
          type: 'DISCOVERED',
          detail: { sourceId: ctx.sourceId },
        })),
      );
      toInsert.forEach((i, idx) => {
        const jobId = insertedIds[idx]!;
        ctx.known.set(i.raw.externalId, { jobId, mappingId: '', isPrimary: true });
        results.push({ externalId: i.raw.externalId, jobId, outcome: 'NEW' });
        // keep the in-memory candidate list current for later batches of this scan
        const list = ctx.companyCandidates.get(i.companyId);
        if (list)
          list.push({
            id: jobId,
            title: i.job.title,
            simhash: i.job.descriptionSimhash,
            sourceIds: [ctx.sourceId],
          });
      });
    }

    // ── Attach mappings to canonical jobs found in steps 2–4 (and batch dups) ──
    if (toAttach.length > 0) {
      const resolved = toAttach.map((a) => ({
        ...a,
        jobId: a.jobId.startsWith('#') ? insertedIds[Number(a.jobId.slice(1))]! : a.jobId,
      }));
      await this.db
        .insert(jobSourceMappings)
        .values(
          resolved.map((a) => ({
            jobId: a.jobId,
            sourceId: ctx.sourceId,
            externalId: a.item.raw.externalId,
            sourceUrl: a.item.job.sourceUrl,
            rawPayload: boundedPayload(a.item.raw.raw),
            isPrimary: false,
            firstSeenAt: now,
            lastSeenAt: now,
          })),
        )
        .onConflictDoNothing();
      const attachedIds = [...new Set(resolved.map((a) => a.jobId))];
      await db.update(jobs).set({ lastSeenAt: now }).where(inArray(jobs.id, attachedIds));
      await db.insert(jobEvents).values(
        resolved.map((a) => ({
          jobId: a.jobId,
          type: a.matchedBy === 'SIMHASH' ? 'DEDUPED_FUZZY' : 'DEDUPED',
          detail: { sourceId: ctx.sourceId, matchedBy: a.matchedBy },
        })),
      );
      for (const a of resolved) {
        ctx.known.set(a.item.raw.externalId, { jobId: a.jobId, mappingId: '', isPrimary: false });
        results.push({
          externalId: a.item.raw.externalId,
          jobId: a.jobId,
          outcome: 'ATTACHED',
          matchedBy: a.matchedBy,
        });
      }
    }
    return results;
  }

  private async applyContentUpdate(
    db: Db,
    jobId: string,
    job: NormalizedJob,
    probe: JobProbe,
    now: Date,
  ): Promise<void> {
    const urlChanged = probe.applicationUrl !== job.applicationUrl;
    await this.db
      .update(jobs)
      .set({
        ...contentFields(job),
        lastSeenAt: now,
        ...(urlChanged ? { finalApplicationUrl: null } : {}),
      })
      .where(eq(jobs.id, jobId));
    await db.insert(jobEvents).values({ jobId, type: 'UPDATED', detail: { urlChanged } });
  }

  /** Same company, recent, similar title AND near-identical description; never two postings of the same source. */
  private async findFuzzy(db: Db, item: DedupeItem, ctx: DedupeContext): Promise<string | null> {
    let candidates = ctx.companyCandidates.get(item.companyId);
    if (!candidates) {
      const rows = await this.db
        .select({
          id: jobs.id,
          title: jobs.title,
          simhash: jobs.descriptionSimhash,
          sourceIds: sql<string[]>`coalesce(array_agg(${jobSourceMappings.sourceId}::text), '{}')`,
        })
        .from(jobs)
        .leftJoin(jobSourceMappings, eq(jobSourceMappings.jobId, jobs.id))
        .where(
          and(
            eq(jobs.companyId, item.companyId),
            ne(jobs.status, 'EXPIRED'),
            sql`${jobs.firstSeenAt} > now() - interval '60 days'`,
          ),
        )
        .groupBy(jobs.id)
        .limit(300);
      candidates = rows;
      ctx.companyCandidates.set(item.companyId, candidates);
    }
    const target = simhashFromSigned(item.job.descriptionSimhash);
    for (const c of candidates) {
      if (c.simhash === null || c.sourceIds.includes(ctx.sourceId)) continue;
      if (hammingDistance(simhashFromSigned(c.simhash), target) > SIMHASH_MAX_DISTANCE) continue;
      if (titleSimilarity(c.title, item.job.title) < TITLE_MIN_SIMILARITY) continue;
      return c.id;
    }
    return null;
  }
}

function contentFields(job: NormalizedJob) {
  return {
    title: job.title,
    description: job.description,
    descriptionHtml: job.descriptionHtml,
    requirements: job.requirements,
    skills: job.skills,
    locationText: job.locationText,
    experienceText: job.experienceText,
    salaryText: job.salaryText,
    applicationUrl: job.applicationUrl,
    contentHash: job.contentHash,
  };
}

function toInsertRow(i: DedupeItem, now: Date): typeof jobs.$inferInsert {
  const job = i.job;
  return {
    companyId: i.companyId,
    ...contentFields(job),
    normalizedTitle: job.normalizedTitle,
    roleFamily: job.roleFamily,
    category: job.category,
    locationCity: job.locationCity,
    locationCountry: job.locationCountry,
    isRemote: job.isRemote,
    employmentType: job.employmentType,
    experienceMinYears: numStr(job.experienceMinYears),
    experienceMaxYears: numStr(job.experienceMaxYears),
    salaryMin: numStr(job.salaryMin),
    salaryMax: numStr(job.salaryMax),
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    postedAt: job.postedAt,
    deadline: job.deadline,
    firstSeenAt: now,
    lastSeenAt: now,
    sourceUrl: job.sourceUrl,
    dedupeKey: job.dedupeKey,
    descriptionSimhash: job.descriptionSimhash,
    status: 'DISCOVERED',
  };
}

function numStr(n: number | null): string | null {
  return n === null ? null : String(n);
}

function boundedPayload(raw: unknown): unknown {
  if (raw === undefined) return null;
  try {
    const s = JSON.stringify(raw);
    return s.length > RAW_PAYLOAD_MAX_BYTES ? { truncated: true, bytes: s.length } : raw;
  } catch {
    return null;
  }
}
