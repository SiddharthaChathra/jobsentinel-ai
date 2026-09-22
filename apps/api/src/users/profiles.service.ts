import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import type { Profile, ProfileInput, ProfileSkill, SkillCategory } from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { profileSkills, profiles, skills, users } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';

/** Skill names are matched case-insensitively and by alias; new skills are added to the dictionary. */
export function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9+#.\- /]/g, '')
    .trim();
}

@Injectable()
export class ProfilesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(userId: string): Promise<Profile | null> {
    const row = await this.db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
    if (!row) return null;
    const skillRows = await this.db
      .select({
        id: skills.id,
        name: skills.name,
        normalizedName: skills.normalizedName,
        category: skills.category,
        proficiency: profileSkills.proficiency,
        origin: profileSkills.origin,
      })
      .from(profileSkills)
      .innerJoin(skills, eq(skills.id, profileSkills.skillId))
      .where(eq(profileSkills.profileId, row.id))
      .orderBy(skills.name);
    return toProfile(row, skillRows);
  }

  /**
   * Full replace (PUT). Upserts unknown skills into the dictionary, rewrites profile_skills,
   * bumps `users.profile_version` and marks onboarding complete on first confirmation.
   */
  async replace(userId: string, input: ProfileInput): Promise<Profile> {
    await this.db.transaction(async (tx) => {
      const [profile] = await tx
        .insert(profiles)
        .values({ userId, ...toRow(input), confirmedAt: new Date() })
        .onConflictDoUpdate({
          target: profiles.userId,
          set: { ...toRow(input), confirmedAt: new Date(), updatedAt: new Date() },
        })
        .returning({ id: profiles.id });
      if (!profile) throw new AppError('PROFILE_SAVE_FAILED', 'Could not save profile', 500);

      // Dictionary upsert by normalized name (aliases are matched on read, not here).
      const skillIds: { skillId: string; proficiency: string | null }[] = [];
      for (const s of dedupeSkills(input.skills)) {
        const normalized = normalizeSkillName(s.name);
        if (!normalized) continue;
        const [row] = await tx
          .insert(skills)
          .values({ name: s.name.trim(), normalizedName: normalized, category: s.category })
          .onConflictDoUpdate({ target: skills.normalizedName, set: { updatedAt: new Date() } })
          .returning({ id: skills.id });
        if (row) skillIds.push({ skillId: row.id, proficiency: s.proficiency });
      }
      await tx.delete(profileSkills).where(eq(profileSkills.profileId, profile.id));
      if (skillIds.length > 0) {
        await tx.insert(profileSkills).values(
          skillIds.map((s) => ({
            profileId: profile.id,
            skillId: s.skillId,
            proficiency: s.proficiency,
            origin: 'USER',
          })),
        );
      }
      await tx
        .update(users)
        .set({
          profileVersion: sql`${users.profileVersion} + 1`,
          onboardingCompletedAt: sql`coalesce(${users.onboardingCompletedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    });
    const saved = await this.get(userId);
    if (!saved) throw new AppError('PROFILE_SAVE_FAILED', 'Could not load saved profile', 500);
    return saved;
  }

  async searchSkills(
    q: string,
    limit = 15,
  ): Promise<{ id: string; name: string; category: string }[]> {
    const needle = `%${normalizeSkillName(q)}%`;
    const rows = await this.db
      .select({ id: skills.id, name: skills.name, category: skills.category })
      .from(skills)
      .where(
        or(
          ilike(skills.normalizedName, needle),
          sql`exists (select 1 from unnest(${skills.aliases}) a where a ilike ${needle})`,
        ),
      )
      .orderBy(skills.name)
      .limit(limit);
    return rows;
  }

  async hasProfile(userId: string): Promise<boolean> {
    const row = await this.db.query.profiles.findFirst({
      where: and(eq(profiles.userId, userId)),
      columns: { id: true },
    });
    return Boolean(row);
  }
}

function dedupeSkills(list: ProfileInput['skills']): ProfileInput['skills'] {
  const seen = new Set<string>();
  return list.filter((s) => {
    const k = normalizeSkillName(s.name);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function toRow(input: ProfileInput) {
  return {
    sourceResumeId: input.sourceResumeId,
    experienceLevel: input.experienceLevel,
    graduationYear: input.graduationYear,
    degree: input.degree,
    branch: input.branch,
    college: input.college,
    locationText: input.locationText,
    summary: input.summary,
    education: input.education,
    projects: input.projects,
    experience: input.experience,
    certifications: input.certifications,
  };
}

function toProfile(
  row: typeof profiles.$inferSelect,
  skillRows: {
    id: string;
    name: string;
    normalizedName: string;
    category: string;
    proficiency: string | null;
    origin: string;
  }[],
): Profile {
  return {
    id: row.id,
    userId: row.userId,
    sourceResumeId: row.sourceResumeId,
    experienceLevel: row.experienceLevel,
    graduationYear: row.graduationYear,
    degree: row.degree,
    branch: row.branch,
    college: row.college,
    locationText: row.locationText,
    summary: row.summary,
    education: row.education as Profile['education'],
    projects: row.projects as Profile['projects'],
    experience: row.experience as Profile['experience'],
    certifications: row.certifications as Profile['certifications'],
    skills: skillRows.map((s): ProfileSkill => ({
      id: s.id,
      name: s.name,
      normalizedName: s.normalizedName,
      category: s.category as SkillCategory,
      proficiency: s.proficiency as ProfileSkill['proficiency'],
      origin: s.origin as ProfileSkill['origin'],
    })),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
