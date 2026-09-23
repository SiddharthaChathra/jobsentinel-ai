import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { classifyRoleFamily, normalizeTitle } from '@jobsentinel/validation';
import { ResumeProfileDraft, type ProfileInput } from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { preferredRoles, resumes, users } from '../common/db/schema';
import { ProfilesService } from '../users/profiles.service';
import { AppModule } from '../app.module';

/**
 * Applies an already-analysed resume to the user's profile
 * (`pnpm apply-resume --user=<uuid> [--dry]`).
 *
 * This is the same write the onboarding "confirm" step performs — it goes through
 * `ProfilesService.replace`, so `profile_version` is bumped and every job is re-scored against
 * the new profile. It exists for the case where a resume was uploaded and analysed but
 * onboarding was never completed, leaving the analysis stranded.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const userId = args.find((a) => a.startsWith('--user='))?.slice('--user='.length);
  if (!userId) throw new Error('--user=<uuid> is required');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const db = app.get<Db>(DB);
    const resume = await db.query.resumes.findFirst({
      where: (r, { and }) => and(eq(r.userId, userId), eq(resumes.isActive, true)),
    });
    if (!resume?.aiAnalysis) throw new Error('no analysed active resume for that user');

    const draft = ResumeProfileDraft.parse(resume.aiAnalysis);
    const input: ProfileInput = {
      sourceResumeId: resume.id,
      experienceLevel: draft.experienceLevel,
      graduationYear: draft.graduationYear,
      degree: draft.degree,
      branch: draft.branch,
      college: draft.college,
      locationText: draft.location,
      summary: draft.summary,
      education: draft.education,
      projects: draft.projects,
      experience: draft.experience,
      certifications: draft.certifications,
      skills: draft.skills.map((s: ResumeProfileDraft['skills'][number]) => ({
        name: s.name,
        category: s.category,
        proficiency: s.proficiency,
      })),
    };

    console.warn(
      JSON.stringify({
        mode: dry ? 'dry-run' : 'apply',
        file: resume.fileName,
        skills: input.skills.length,
        suggestedRoles: draft.suggestedRoles.length,
        college: input.college,
        graduationYear: input.graduationYear,
      }),
    );
    if (dry) return;

    await app.get(ProfilesService).replace(userId, input);

    // The AI's suggested roles are what the onboarding preferences step pre-fills.
    if (draft.suggestedRoles.length > 0) {
      const existing = await db
        .select()
        .from(preferredRoles)
        .where(eq(preferredRoles.userId, userId));
      if (existing.length === 0) {
        await db.insert(preferredRoles).values(
          draft.suggestedRoles
            .slice(0, 8)
            .map((role: ResumeProfileDraft['suggestedRoles'][number]) => ({
              userId,
              title: role.title,
              normalizedTitle: normalizeTitle(role.title),
              // The draft suggests a title and a tier; the family comes from the same classifier
              // the ingestion pipeline uses, so preferences and jobs speak one vocabulary.
              roleFamily: classifyRoleFamily(role.title).roleFamily,
              tier: role.tier,
            })),
        );
      }
    }

    const [user] = await db
      .select({ v: users.profileVersion })
      .from(users)
      .where(eq(users.id, userId));
    console.warn(`applied. profile_version is now ${user?.v ?? '?'} — re-run match to rescore.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
