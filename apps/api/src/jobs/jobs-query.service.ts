import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  JobsQuery,
  type ApplicationStatus,
  type EmploymentType,
  type JobCard,
  type JobSort,
  type TrackerState,
  type HeldInfo,
} from '@jobsentinel/types';
import { adzunaAttribution, heldInfo, MAX_FRESHER_MIN_YEARS } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import {
  applications,
  companies,
  jobMatches,
  jobs,
  preferences,
  savedJobs,
  users,
} from '../common/db/schema';

const DEFAULT_LIMIT = 25;
const NEW_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Statuses a job must be in to appear in the user's lists at all (docs 03 §3). */
/**
 * SQL mirror of `isFresherRole` (D96) for a jobs table alias: a stated minimum of zero (unless the
 * role is EXPERIENCED), or no stated minimum and a FRESHER / ENTRY_LEVEL classification.
 */
export function fresherRoleSql(alias: string): SQL {
  const a = sql.raw(alias);
  const max = sql.raw(String(MAX_FRESHER_MIN_YEARS));
  return sql`((${a}.experience_min_years is not null and ${a}.experience_min_years <= ${max} and ${a}.experience_level <> 'EXPERIENCED') or (${a}.experience_min_years is null and ${a}.experience_level in ('FRESHER', 'ENTRY_LEVEL')))`;
}

const LISTABLE = ['VALID', 'NEEDS_REVIEW', 'MATCHED', 'NOTIFY_PENDING', 'NOTIFIED'] as const;

/** One row of the list query: the job, its company, this user's match and tracker state. */
type Row = Awaited<ReturnType<JobsQueryService['select']>>[number];

/** What a job list needs to know about the viewing user. */
export interface Viewer {
  profileVersion: number;
  locations: string[];
  employmentTypes: EmploymentType[];
}

/**
 * Read side of the jobs API (docs 03 §3). Every list goes through `list()` so `/jobs`,
 * `/saved-jobs`, `/applications` and the dashboard all return the identical `JobCard` shape.
 *
 * Scores are per profile version: the join is pinned to the user's current version so an old
 * score from a previous resume is never shown as if it were current.
 */
@Injectable()
export class JobsQueryService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * `viewer` is what the list needs to know about the user. A caller that lists more than once
   * per request (the dashboard) loads it once and passes it in; otherwise it costs one query.
   */
  async list(
    userId: string,
    query: JobsQuery,
    viewer?: Viewer,
    opts: { review?: boolean } = {},
  ): Promise<{ items: JobCard[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const sort: JobSort = query.sort ?? 'newest';
    const { profileVersion, locations, employmentTypes } = viewer ?? (await this.viewer(userId));

    const where = this.buildWhere(query, locations, employmentTypes, opts.review === true);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.select(userId, profileVersion, [
      ...where,
      ...(cursor ? [cursorPredicate(sort, cursor)] : []),
    ])
      .orderBy(...orderFor(sort))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && page.length > 0 ? encodeCursor(sort, page[page.length - 1]!) : null;
    return { items: page.map(toCard), nextCursor };
  }

  /** Shared projection — kept in one place so every list returns the same `JobCard`. */
  private select(userId: string, profileVersion: number, where: (SQL | undefined)[]) {
    return this.db
      .select({
        job: jobs,
        company: {
          id: companies.id,
          name: companies.name,
          domain: companies.websiteDomain,
          verificationStatus: companies.verificationStatus,
          // Badge only, never a filter (F4, D118).
          hiresFreshersOften: sql<boolean>`exists (select 1 from company_fresher_stats c where c.company_id = ${companies.id} and c.band = 'HIGH')`,
        },
        match: {
          overallScore: jobMatches.overallScore,
          priority: jobMatches.priority,
          matchedSkills: jobMatches.matchedSkills,
          scoring: jobMatches.scoring,
        },
        // The country of the Adzuna search the displayed content came from, if it did (D115).
        adzunaCountry: sql<
          string | null
        >`(select coalesce(s.config->>'country', 'in') from job_source_mappings m join job_sources s on s.id = m.source_id where m.job_id = ${jobs.id} and m.is_primary and s.adapter = 'adzuna' limit 1)`,
        saved: sql<boolean>`${savedJobs.jobId} is not null`,
        trackerStatus: applications.status,
        viewedAt: sql<Date | null>`case when ${applications.status} is null then null else ${applications.createdAt} end`,
      })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(
        jobMatches,
        and(
          eq(jobMatches.jobId, jobs.id),
          eq(jobMatches.userId, userId),
          eq(jobMatches.profileVersion, profileVersion),
        ),
      )
      .leftJoin(savedJobs, and(eq(savedJobs.jobId, jobs.id), eq(savedJobs.userId, userId)))
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, userId)))
      .where(and(...where.filter(Boolean)));
  }

  private buildWhere(
    q: JobsQuery,
    userLocations: string[] = [],
    userEmploymentTypes: string[] = [],
    review = false,
  ): (SQL | undefined)[] {
    // The Needs review view (D106): held jobs only — never in the main list. Suspected scams
    // (SUSPICIOUS) are not "needs review" and stay out of both. Every other gate below applies.
    const where: (SQL | undefined)[] = review
      ? [
          eq(jobs.status, 'NEEDS_REVIEW'),
          sql`${jobs.validationStatus} is distinct from 'SUSPICIOUS'`,
        ]
      : [inArray(jobs.status, [...LISTABLE])];

    // Validation status defaults to VALID only: a job we could not confirm is opt-in (docs 08).
    // A job held at classification can be VALID too; it belongs to the review view only (D110).
    if (!review) {
      where.push(inArray(jobs.validationStatus, q.validationStatus ?? ['VALID']));
      where.push(isNull(jobs.holdReason));
    }

    const activity = q.status ?? 'ACTIVE';
    if (activity === 'ACTIVE') where.push(sql`${jobs.closedAt} is null`);
    else if (activity === 'EXPIRED') where.push(isNotNull(jobs.closedAt));

    if (q.q) {
      // Plain-language search over the indexed title+description document.
      where.push(
        sql`to_tsvector('english', ${jobs.title} || ' ' || ${jobs.description}) @@ plainto_tsquery('english', ${q.q})`,
      );
    }
    if (q.roleFamily?.length) where.push(inArray(jobs.roleFamily, q.roleFamily));
    if (q.category?.length) where.push(inArray(jobs.category, q.category));
    if (q.companyId) where.push(eq(jobs.companyId, q.companyId));
    if (q.location) {
      const like = `%${q.location.toLowerCase()}%`;
      where.push(
        or(
          sql`lower(${jobs.locationCity}) like ${like}`,
          sql`lower(${jobs.locationCountry}) like ${like}`,
          sql`lower(${jobs.locationText}) like ${like}`,
        ),
      );
    } else if (q.anywhere !== true && userLocations.length > 0) {
      // Default to the places the user said they would work. Without this the list is mostly
      // jobs they cannot take — but it is opt-out (`anywhere=true`) and derived from their own
      // preferences rather than a hard-coded country, so it works for any user (D62).
      // Remote jobs and postings that state no location are always kept: "unknown" is not "no".
      const matchers = userLocations.flatMap((loc) => {
        const like = `%${loc.toLowerCase().trim()}%`;
        return [
          sql`lower(${jobs.locationCity}) like ${like}`,
          sql`lower(${jobs.locationCountry}) like ${like}`,
          sql`lower(${jobs.locationText}) like ${like}`,
        ];
      });
      where.push(
        or(
          sql`${jobs.locationCity} is null and ${jobs.locationCountry} is null and ${jobs.locationText} is null`,
          ...matchers,
          // Any remote role, whatever country it names (D102).
          eq(jobs.isRemote, true),
        ),
      );
    }

    if (userEmploymentTypes.length > 0) {
      // Include UNKNOWN so we don't accidentally drop valid jobs just because the source didn't state the type,
      // but strictly filter out INTERNSHIP, TRAINEE etc. if they are not in the user's preferences.
      where.push(
        inArray(jobs.employmentType, [...userEmploymentTypes, 'UNKNOWN'] as EmploymentType[]),
      );
    }

    if (q.remote !== undefined) where.push(eq(jobs.isRemote, q.remote));
    if (q.fresherOnly) where.push(eq(jobs.fresherEligible, true));
    // Roles that accept zero experience only (D96). Classification already filters the rest; this keeps
    // rows classified under older rules out of the list. A user's own saved or tracked jobs stay
    // visible in those views whatever their level.
    if (q.saved !== true && !q.tracker?.length) {
      // The review view also shows jobs held because their experience is unknown (D110): the
      // hold is set only when no stated requirement or EXPERIENCED verdict ruled the job out.
      where.push(
        review ? or(fresherRoleSql('jobs'), isNotNull(jobs.holdReason)) : fresherRoleSql('jobs'),
      );
    }
    if (q.experienceLevel?.length) where.push(inArray(jobs.experienceLevel, q.experienceLevel));
    if (q.postingType?.length) where.push(inArray(jobs.postingType, q.postingType));
    // A posting older than 60 days is almost always filled, so the ceiling applies even when the
    // caller asks for more; a narrower `postedAfter` still narrows it further. `posted_at` is null
    // for boards that do not publish a date, hence the fall back to when we first saw the job.
    // The comparison is written out rather than built with `gte`: a raw `sql` chunk gives drizzle
    // no column to derive an encoder from, so the Date has to be an ISO string with a cast (D55).
    const hardLimit = new Date(Date.now() - 60 * 86_400_000);
    const requested = q.postedAfter ? new Date(q.postedAfter) : null;
    const effectivePostedAfter = requested && requested > hardLimit ? requested : hardLimit;
    where.push(
      sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${effectivePostedAfter.toISOString()}::timestamptz`,
    );
    if (q.salaryMin !== undefined) {
      const meets = gte(jobs.salaryMin, String(q.salaryMin));
      // Undisclosed salaries are kept unless the user opts out (R6, D111): no figure is not a
      // figure below the minimum.
      where.push(q.includeUndisclosedSalary === false ? meets : or(meets, isNull(jobs.salaryMin)));
    }
    if (q.sourceId) {
      where.push(
        sql`exists (select 1 from job_source_mappings m where m.job_id = ${jobs.id} and m.source_id = ${q.sourceId})`,
      );
    }

    // Match-dependent filters. The join is already pinned to the current profile version.
    if (q.minScore !== undefined) where.push(gte(jobMatches.overallScore, q.minScore));
    if (q.priority?.length) where.push(inArray(jobMatches.priority, q.priority));

    if (q.saved === true) where.push(sql`${savedJobs.jobId} is not null`);
    else if (q.saved === false) where.push(sql`${savedJobs.jobId} is null`);
    if (q.tracker?.length) where.push(inArray(applications.status, q.tracker));

    return where;
  }

  /**
   * Why each held job is held (D106): its latest HELD (classification) or VALIDATED reason, and
   * where its application link ended up. One statement for a page of ids.
   */
  async heldReasons(ids: string[]): Promise<Map<string, HeldInfo>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.execute<{
      id: string;
      reason: string | null;
      final_url: string | null;
    }>(sql`
      select j.id,
        -- Classification's hold, unless validation itself found something to review: then its
        -- reason (e.g. company not verified) is the one the user must check first (D110).
        coalesce(
          case when j.validation_status is distinct from 'NEEDS_REVIEW' then j.hold_reason end,
          (select e.detail->>'reason' from job_events e
            where e.job_id = j.id and e.type in ('HELD', 'VALIDATED')
            order by e.created_at desc limit 1)) as reason,
        (select v.final_url from job_validation v where v.job_id = j.id) as final_url
      from jobs j
      where j.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`);
    return new Map(rows.map((r) => [r.id, heldInfo(r.reason, r.final_url)]));
  }

  /**
   * THE eligibility rule (D127): what the dashboard's default list shows a user. Telegram's instant
   * alerts, the digest and the weekly summary add these exact conditions to their own (freshness,
   * score), so no channel can pick a job the dashboard would not list — the parity test in
   * `alert-parity.e2e-spec.ts` fails the moment they diverge.
   */
  eligibleWhere(viewer: Viewer): SQL[] {
    return this.buildWhere(
      JobsQuery.parse({}),
      viewer.locations,
      viewer.employmentTypes,
      false,
    ).filter((c): c is SQL => c !== undefined);
  }

  /**
   * Profile version and list preferences in one round trip rather than two: every query to the
   * pooled database costs a network round trip, which dwarfs the lookup itself (D100).
   */
  async viewer(userId: string): Promise<Viewer> {
    const [row] = await this.db
      .select({
        profileVersion: users.profileVersion,
        locations: preferences.locations,
        employmentTypes: preferences.employmentTypes,
      })
      .from(users)
      .leftJoin(preferences, eq(preferences.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    return {
      profileVersion: row?.profileVersion ?? 0,
      locations: row?.locations ?? [],
      employmentTypes: row?.employmentTypes ?? [],
    };
  }

  /** The version every score shown to this user must belong to. */
  async profileVersion(userId: string): Promise<number> {
    const row = await this.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { profileVersion: true },
    });
    return row?.profileVersion ?? 0;
  }

  /** Used by `/saved-jobs`, `/applications` and the dashboard, which pick their own rows. */
  async cardsByIds(userId: string, ids: string[]): Promise<Map<string, JobCard>> {
    if (ids.length === 0) return new Map();
    const rows = await this.select(userId, await this.profileVersion(userId), [
      inArray(jobs.id, ids),
    ]);
    return new Map(rows.map((r) => [r.job.id, toCard(r)]));
  }

  async trackerState(userId: string, jobId: string): Promise<TrackerState> {
    const [saved, app] = await Promise.all([
      this.db.query.savedJobs.findFirst({
        where: and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)),
        columns: { jobId: true },
      }),
      this.db.query.applications.findFirst({
        where: and(eq(applications.userId, userId), eq(applications.jobId, jobId)),
        columns: { status: true },
      }),
    ]);
    return { saved: Boolean(saved), status: (app?.status as ApplicationStatus) ?? null };
  }
}

function orderFor(sort: JobSort): SQL[] {
  // The id tiebreak makes the cursor stable when two jobs share a timestamp or score.
  if (sort === 'score') {
    return [sql`${jobMatches.overallScore} desc nulls last`, desc(jobs.id)];
  }
  if (sort === 'posted') return [sql`${jobs.postedAt} desc nulls last`, desc(jobs.id)];
  return [desc(jobs.firstSeenAt), desc(jobs.id)];
}

interface Cursor {
  key: string | null;
  id: string;
}

function encodeCursor(sort: JobSort, row: Row): string {
  const key =
    sort === 'score'
      ? row.match?.overallScore != null
        ? String(row.match.overallScore)
        : null
      : sort === 'posted'
        ? (row.job.postedAt?.toISOString() ?? null)
        : row.job.firstSeenAt.toISOString();
  return Buffer.from(JSON.stringify({ key, id: row.job.id })).toString('base64url');
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { key, id } = parsed as { key?: unknown; id?: unknown };
    if (typeof id !== 'string') return null;
    return { key: typeof key === 'string' ? key : null, id };
  } catch {
    return null; // a corrupt cursor restarts the list rather than erroring
  }
}

/**
 * Keyset pagination: everything strictly after the last row in the sort order.
 * `nulls last` means a null key is also "after" every non-null one.
 */
function cursorPredicate(sort: JobSort, c: Cursor): SQL {
  if (sort === 'score') {
    const score = c.key === null ? null : Number(c.key);
    if (score === null) return sql`${jobMatches.overallScore} is null and ${jobs.id} < ${c.id}`;
    return sql`(${jobMatches.overallScore} is null or ${jobMatches.overallScore} < ${score} or (${jobMatches.overallScore} = ${score} and ${jobs.id} < ${c.id}))`;
  }
  const column = sort === 'posted' ? jobs.postedAt : jobs.firstSeenAt;
  if (c.key === null) return sql`${column} is null and ${jobs.id} < ${c.id}`;
  // A raw Date has no encoder inside a sql template; postgres.js needs the ISO string (D54).
  const iso = new Date(c.key).toISOString();
  if (sort === 'posted') {
    return sql`(${column} is null or ${column} < ${iso} or (${column} = ${iso} and ${jobs.id} < ${c.id}))`;
  }
  return sql`(${column} < ${iso} or (${column} = ${iso} and ${jobs.id} < ${c.id}))`;
}

function toCard(row: Row): JobCard {
  const j = row.job;
  const isNew = Date.now() - j.firstSeenAt.getTime() < NEW_WINDOW_MS && row.trackerStatus === null;
  return {
    id: j.id,
    title: j.title,
    company: {
      id: row.company.id,
      name: row.company.name,
      domain: row.company.domain,
      verificationStatus: row.company.verificationStatus,
      hiresFreshersOften: row.company.hiresFreshersOften,
    },
    location: {
      text: j.locationText,
      city: j.locationCity,
      country: j.locationCountry,
      isRemote: j.isRemote,
    },
    employmentType: j.employmentType,
    postingType: j.postingType,
    attribution: row.adzunaCountry === null ? null : adzunaAttribution(row.adzunaCountry),
    experienceLevel: j.experienceLevel,
    fresherEligible: j.fresherEligible,
    experienceText: j.experienceText,
    salary: salaryOf(j),
    postedAt: j.postedAt?.toISOString() ?? null,
    firstSeenAt: j.firstSeenAt.toISOString(),
    deadline: j.deadline?.toISOString() ?? null,
    validation: {
      status: j.validationStatus,
      confidence: j.validationConfidence === null ? null : Number(j.validationConfidence),
      companyVerified: row.company.verificationStatus === 'VERIFIED',
      applicationVerified: j.validationStatus === 'VALID',
      jobActive: j.closedAt === null,
    },
    match:
      row.match?.overallScore != null
        ? {
            overallScore: row.match.overallScore,
            priority: row.match.priority,
            matchedSkills: row.match.matchedSkills ?? [],
            scoring: row.match.scoring ?? 'RULES_ONLY',
          }
        : null,
    tracker: { saved: row.saved, status: row.trackerStatus ?? null },
    // The probed final URL is the one that actually works; fall back to what the source gave us.
    applicationUrl: j.finalApplicationUrl ?? j.applicationUrl ?? j.sourceUrl,
    isNew,
  };
}

function salaryOf(j: Row['job']): JobCard['salary'] {
  return {
    min: j.salaryMin === null ? null : Number(j.salaryMin),
    max: j.salaryMax === null ? null : Number(j.salaryMax),
    currency: j.salaryCurrency,
    period: j.salaryPeriod,
    text: j.salaryText,
    disclosed: j.salaryDisclosed,
  };
}

export { toCard, LISTABLE };
