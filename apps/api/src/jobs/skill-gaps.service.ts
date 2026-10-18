import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { approvedLearningLinks } from '@jobsentinel/config';
import { JobsQuery, type SkillGapReport } from '@jobsentinel/types';
import { rankSkillGaps } from '@jobsentinel/validation';
import { DB, type Db } from '../common/db/db.module';
import { jobMatches } from '../common/db/schema';
import { JobsQueryService } from './jobs-query.service';

/** The report is built from this many top matches (F7). */
const TOP_MATCHES = 15;

/**
 * Skill-gap report (F7, D120). The top matches come from `JobsQueryService.list` sorted by score —
 * the very list `/jobs` shows, so only India/remote, zero-experience, validated jobs inside the
 * 60-day window count (and never a PLACEHOLDER or a held job). Rules only: zero AI cost.
 */
@Injectable()
export class SkillGapsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly query: JobsQueryService,
  ) {}

  async report(userId: string, opts: { limit?: number } = {}): Promise<SkillGapReport> {
    const viewer = await this.query.viewer(userId);
    const { items } = await this.query.list(
      userId,
      JobsQuery.parse({ sort: 'score', limit: TOP_MATCHES }),
      viewer,
    );
    const top = items.filter((c) => c.match !== null);
    const missing =
      top.length === 0
        ? []
        : await this.db
            .select({ jobId: jobMatches.jobId, missing: jobMatches.missingSkills })
            .from(jobMatches)
            .where(
              and(
                eq(jobMatches.userId, userId),
                eq(jobMatches.profileVersion, viewer.profileVersion),
                inArray(
                  jobMatches.jobId,
                  top.map((c) => c.id),
                ),
              ),
            );
    const byJob = new Map(missing.map((m) => [m.jobId, m.missing]));
    const inputs = top.map((c) => ({
      id: c.id,
      title: c.title,
      company: c.company.name,
      missingSkills: byJob.get(c.id) ?? [],
    }));
    const gaps = rankSkillGaps(inputs, opts.limit ?? 10);
    // Soft skills never take a top-3 place; they get their own short note (owner, D120).
    const soft = rankSkillGaps(inputs, 3, { soft: 'only' });
    return {
      basedOn: top.length,
      softSkills: soft.map(({ skill, missingIn, of }) => ({ skill, missingIn, of })),
      generatedAt: new Date().toISOString(),
      gaps: gaps.map((g) => ({
        ...g,
        links: approvedLearningLinks(g.skill).map(({ title, url, publisher }) => ({
          title,
          url,
          publisher,
        })),
      })),
    };
  }
}
