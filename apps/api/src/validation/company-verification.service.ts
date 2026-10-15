import { lookup } from 'node:dns/promises';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, ne, sql } from 'drizzle-orm';
import { lookalikeOf, type Evidence } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { companies, jobSourceMappings, jobSources, jobs } from '../common/db/schema';
import { HTTP_CLIENT } from '../common/http/http.module';
import type { HttpClientPort } from '../common/http/http-client';

export interface CompanyVerification {
  companyId: string;
  evidence: Evidence[];
  score: number;
  verified: boolean;
  blocked: boolean;
  trusted: boolean;
  domain: string | null;
  atsSlug: string | null;
}

/** Re-verification interval: company facts change slowly (docs 08 §3.2). */
const CACHE_DAYS = 7;

type CompanyRow = typeof companies.$inferSelect;

/**
 * Evidence-based company verification (docs 08 §3.2). No paid registry lookups: the signals are
 * the company's own ATS board, DNS, homepage reachability, multi-source presence and the user's
 * trust list. Results are cached on the company row for a week.
 */
@Injectable()
export class CompanyVerificationService {
  private readonly logger = new Logger(CompanyVerificationService.name);
  private knownDomainsCache: { at: number; domains: string[] } = { at: 0, domains: [] };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(HTTP_CLIENT) private readonly http: HttpClientPort,
  ) {}

  async verify(company: CompanyRow, opts: { force?: boolean } = {}): Promise<CompanyVerification> {
    const fresh =
      company.verifiedAt !== null &&
      Date.now() - company.verifiedAt.getTime() < CACHE_DAYS * 86_400_000;
    if (fresh && !opts.force) {
      const cached = (company.verificationEvidence ?? []) as Evidence[];
      return this.toResult(company, cached);
    }

    const evidence: Evidence[] = [];

    if (company.isTrusted)
      evidence.push({
        check: 'COMPANY_TRUSTED',
        passed: true,
        weight: 0.5,
        detail: 'marked trusted by you',
      });
    if (company.atsProvider && company.atsSlug) {
      evidence.push({
        check: 'SOURCE_IS_ATS_BOARD',
        passed: true,
        weight: 0.35,
        detail: `${company.atsProvider} board "${company.atsSlug}"`,
      });
    }

    if (company.websiteDomain) {
      const host = company.websiteDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const resolves = await this.resolves(host);
      evidence.push({
        check: 'DOMAIN_RESOLVES',
        passed: resolves,
        weight: resolves ? 0.1 : -0.2,
        detail: host,
      });
      if (resolves) {
        const reachable = await this.homepageReachable(host);
        evidence.push({
          check: 'HOMEPAGE_REACHABLE',
          passed: reachable,
          weight: reachable ? 0.1 : 0,
          detail: reachable ? `https://${host} responded` : `https://${host} did not respond`,
        });
      }
      const known = await this.knownDomains();
      const lookalike = lookalikeOf(
        host,
        known.filter((d) => d !== host),
      );
      if (lookalike) {
        evidence.push({
          check: 'DOMAIN_LOOKALIKE',
          passed: false,
          weight: -0.4,
          detail: `${host} resembles ${lookalike}`,
        });
      }
    } else {
      evidence.push({
        check: 'NO_DOMAIN_KNOWN',
        passed: false,
        weight: -0.1,
        detail: 'no website domain on record',
      });
    }

    const sourceCount = await this.independentSourceCount(company.id);
    if (sourceCount >= 2)
      evidence.push({
        check: 'MULTI_SOURCE',
        passed: true,
        weight: 0.1,
        detail: `seen via ${sourceCount} independent providers`,
      });

    const result = this.toResult(company, evidence);
    await this.db
      .update(companies)
      .set({
        verificationEvidence: evidence,
        verificationConfidence: result.score.toFixed(2),
        verificationStatus: company.isBlocked
          ? 'BLOCKED'
          : result.verified
            ? 'VERIFIED'
            : result.score < 0.35
              ? 'SUSPICIOUS'
              : 'UNVERIFIED',
        verifiedAt: new Date(),
        sourcesCount: sourceCount,
      })
      .where(eq(companies.id, company.id));
    return result;
  }

  private toResult(company: CompanyRow, evidence: Evidence[]): CompanyVerification {
    const score = Math.max(0, Math.min(1, 0.5 + evidence.reduce((a, e) => a + e.weight, 0)));
    return {
      companyId: company.id,
      evidence,
      score,
      verified: score >= 0.5,
      blocked: company.isBlocked,
      trusted: company.isTrusted,
      domain: company.websiteDomain,
      atsSlug: company.atsSlug,
    };
  }

  private async resolves(host: string): Promise<boolean> {
    try {
      const addrs = await lookup(host, { all: true });
      return addrs.length > 0;
    } catch {
      return false;
    }
  }

  private async homepageReachable(host: string): Promise<boolean> {
    try {
      const res = await this.http.request(`https://${host}`, {
        timeoutMs: 10_000,
        retries: 0,
        maxBodyBytes: 256 * 1024,
      });
      return res.status < 400 || res.status === 403; // 403 still proves a live site exists
    } catch {
      return false;
    }
  }

  /**
   * How many independent providers have listed any job of this company (docs 08 §3.2: "≥2
   * independent sources"). Counted per adapter, not per source row: two Adzuna keyword searches
   * return the same Adzuna posting, which confirms nothing twice — that alone once verified a
   * company with no known domain (D83).
   */
  private async independentSourceCount(companyId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(distinct ${jobSources.adapter})` })
      .from(jobSourceMappings)
      .innerJoin(jobs, eq(jobs.id, jobSourceMappings.jobId))
      .innerJoin(jobSources, eq(jobSources.id, jobSourceMappings.sourceId))
      .where(eq(jobs.companyId, companyId));
    return Number(row?.n ?? 0);
  }

  /** Domains of trusted companies — the reference set for look-alike detection. */
  private async knownDomains(): Promise<string[]> {
    if (Date.now() - this.knownDomainsCache.at < 3600_000) return this.knownDomainsCache.domains;
    const rows = await this.db
      .select({ domain: companies.websiteDomain })
      .from(companies)
      .where(
        sql`${companies.isTrusted} = true and ${companies.websiteDomain} is not null and ${ne(companies.websiteDomain, '')}`,
      );
    const domains = rows.map((r) => r.domain!).filter(Boolean);
    this.knownDomainsCache = { at: Date.now(), domains };
    return domains;
  }
}
