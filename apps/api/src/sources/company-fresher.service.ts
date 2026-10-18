import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { FRESHER_SCORE } from '@jobsentinel/config';
import type { FresherBand } from '@jobsentinel/types';
import { fresherScore } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { companyFresherStats } from '../common/db/schema';
import { fresherRoleSql } from '../jobs/jobs-query.service';

type AggRow = {
  company_id: string;
  postings_seen: number;
  fresher_count: number;
  weighted_all: number;
  weighted_fresher: number;
  days_since_last_fresher: number | null;
  last_fresher_at: string | Date | null;
};

/** Recomputed at most this often; the inputs change only as fast as scans add postings. */
const RECOMPUTE_EVERY_MS = 3_600_000;

/**
 * Company "accepts freshers" score (F4, D118; formula in docs/sources.md). The sums are computed
 * in SQL and the score by the pure `fresherScore`, which the unit tests pin to the formula.
 *
 * Read by exactly two things: a company board's scan interval (`bandFor`, SourceManager) and the
 * "Hires freshers often" badge. Never by classification, validation, matching or notifications —
 * a score must never reject a job.
 */
@Injectable()
export class CompanyFresherService {
  private readonly logger = new Logger(CompanyFresherService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Worker stage: recompute when the last run is over an hour old (or `force`). */
  async recomputeIfStale(force = false): Promise<{ companies: number } | { skipped: true }> {
    if (!force) {
      const [row] = await this.db.execute<{ at: string | Date | null }>(
        sql`select max(computed_at) as at from company_fresher_stats`,
      );
      const at = row?.at ? new Date(row.at).getTime() : 0;
      if (Date.now() - at < RECOMPUTE_EVERY_MS) return { skipped: true };
    }
    return this.recompute();
  }

  /**
   * One aggregate over the window, then batched upserts. A posting is fresher-eligible when it
   * passes the experience rule the list uses (`fresherRoleSql`) and was not filtered for its
   * location or batch: a company hiring new graduates only abroad does not help an India search.
   * Unclassified (DISCOVERED) and PLACEHOLDER rows are not postings (D117).
   */
  async recompute(companyIds?: string[]): Promise<{ companies: number }> {
    const scope = companyIds?.length
      ? sql`and j.company_id in (${sql.join(
          companyIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
    const window = sql.raw(String(FRESHER_SCORE.windowDays));
    const halfLife = sql.raw(String(FRESHER_SCORE.shareHalfLifeDays));
    const rows = await this.db.execute<AggRow>(sql`
      with p as (
        select j.company_id,
          coalesce(j.posted_at, j.first_seen_at) as at,
          greatest(0, extract(epoch from (now() - coalesce(j.posted_at, j.first_seen_at))) / 86400.0) as age,
          (${fresherRoleSql('j')} and coalesce(f.reason, '') !~ '^(location outside India|targets the )') as fresher
        from jobs j
        left join lateral (
          select e.detail->>'reason' as reason from job_events e
          where j.status = 'FILTERED_OUT' and e.job_id = j.id and e.type = 'FILTERED_OUT'
          order by e.created_at desc limit 1
        ) f on true
        where j.status not in ('DISCOVERED', 'PLACEHOLDER')
          and coalesce(j.posted_at, j.first_seen_at) >= now() - (${window} * interval '1 day')
          ${scope}
      )
      select company_id,
        count(*)::int as postings_seen,
        (count(*) filter (where fresher))::int as fresher_count,
        sum(power(0.5, age / ${halfLife}))::float8 as weighted_all,
        coalesce(sum(power(0.5, age / ${halfLife})) filter (where fresher), 0)::float8 as weighted_fresher,
        (min(age) filter (where fresher))::float8 as days_since_last_fresher,
        max(at) filter (where fresher) as last_fresher_at
      from p group by company_id`);

    const now = new Date();
    const values = rows.map((r) => {
      const { score, band } = fresherScore({
        postingsSeen: r.postings_seen,
        fresherCount: r.fresher_count,
        weightedAll: Number(r.weighted_all),
        weightedFresher: Number(r.weighted_fresher),
        daysSinceLastFresher:
          r.days_since_last_fresher === null ? null : Number(r.days_since_last_fresher),
      });
      return {
        companyId: r.company_id,
        postingsSeen: r.postings_seen,
        fresherCount: r.fresher_count,
        lastFresherAt: r.last_fresher_at ? new Date(r.last_fresher_at) : null,
        weightedAll: Number(r.weighted_all),
        weightedFresher: Number(r.weighted_fresher),
        score,
        band,
        computedAt: now,
        updatedAt: now,
      };
    });
    for (let i = 0; i < values.length; i += 50) {
      await this.db
        .insert(companyFresherStats)
        .values(values.slice(i, i + 50))
        .onConflictDoUpdate({
          target: companyFresherStats.companyId,
          set: {
            postingsSeen: sql`excluded.postings_seen`,
            fresherCount: sql`excluded.fresher_count`,
            lastFresherAt: sql`excluded.last_fresher_at`,
            weightedAll: sql`excluded.weighted_all`,
            weightedFresher: sql`excluded.weighted_fresher`,
            score: sql`excluded.score`,
            band: sql`excluded.band`,
            computedAt: sql`excluded.computed_at`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    // A company whose postings all left the window is no longer judged: back to neutral.
    if (!companyIds?.length) {
      await this.db.execute(sql`
        update company_fresher_stats set postings_seen = 0, fresher_count = 0, weighted_all = 0,
          weighted_fresher = 0, score = null, band = 'UNKNOWN', computed_at = ${now.toISOString()}::timestamptz,
          updated_at = now()
        where computed_at < ${now.toISOString()}::timestamptz`);
    }
    this.logger.log(`fresher scores recomputed for ${values.length} companies`);
    return { companies: values.length };
  }

  /** The band that spaces this company's board; null when it has never been scored. */
  async bandFor(companyId: string): Promise<FresherBand | null> {
    const [row] = await this.db
      .select({ band: companyFresherStats.band })
      .from(companyFresherStats)
      .where(eq(companyFresherStats.companyId, companyId))
      .limit(1);
    return row?.band ?? null;
  }
}
