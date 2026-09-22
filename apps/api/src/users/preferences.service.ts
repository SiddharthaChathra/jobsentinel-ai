import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { classifyRoleFamily, normalizeTitle } from '@jobsentinel/validation';
import type {
  Preferences,
  PreferencesInput,
  PreferredRole,
  PreferredRoleInput,
} from '@jobsentinel/types';
import { DB, type Db } from '../common/db/db.module';
import { preferences, preferredRoles, users } from '../common/db/schema';
import { AppError } from '../common/errors/app-error';

/** Fields whose change affects matching and therefore bump `profile_version` (docs 00 D24). */
const MATCHING_FIELDS: (keyof PreferencesInput)[] = [
  'locations',
  'remotePreference',
  'employmentTypes',
  'categories',
  'fresherOnly',
  'includeUnknownExperience',
  'salaryMin',
  'graduationYear',
];

@Injectable()
export class PreferencesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(userId: string): Promise<Preferences> {
    const row = await this.db.query.preferences.findFirst({
      where: eq(preferences.userId, userId),
    });
    if (!row) throw AppError.notFound('PREFERENCES_NOT_FOUND');
    return toPreferences(row);
  }

  async replace(userId: string, input: PreferencesInput): Promise<Preferences> {
    const current = await this.get(userId);
    const matchingChanged = MATCHING_FIELDS.some(
      (k) => JSON.stringify(current[k]) !== JSON.stringify(input[k]),
    );
    await this.db.transaction(async (tx) => {
      await tx
        .update(preferences)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(preferences.userId, userId));
      if (matchingChanged) {
        await tx
          .update(users)
          .set({ profileVersion: sql`${users.profileVersion} + 1`, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
    });
    return this.get(userId);
  }

  async listRoles(userId: string): Promise<PreferredRole[]> {
    const rows = await this.db.query.preferredRoles.findMany({
      where: eq(preferredRoles.userId, userId),
      orderBy: (r, { asc }) => [asc(r.tier), asc(r.title)],
    });
    return rows.map(toPreferredRole);
  }

  /** Full replace of the role list; duplicates (by normalized title) collapse to the first entry. */
  async replaceRoles(userId: string, input: PreferredRoleInput[]): Promise<PreferredRole[]> {
    const seen = new Set<string>();
    const values = input
      .map((r) => {
        const normalizedTitle = normalizeTitle(r.title);
        return {
          userId,
          title: r.title.trim(),
          normalizedTitle,
          roleFamily: classifyRoleFamily(r.title).roleFamily,
          tier: r.tier,
          enabled: r.enabled,
        };
      })
      .filter((r) => {
        if (!r.normalizedTitle || seen.has(r.normalizedTitle)) return false;
        seen.add(r.normalizedTitle);
        return true;
      });

    await this.db.transaction(async (tx) => {
      await tx.delete(preferredRoles).where(eq(preferredRoles.userId, userId));
      if (values.length > 0) await tx.insert(preferredRoles).values(values);
      await tx
        .update(users)
        .set({ profileVersion: sql`${users.profileVersion} + 1`, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
    return this.listRoles(userId);
  }
}

function toPreferences(row: typeof preferences.$inferSelect): Preferences {
  return {
    userId: row.userId,
    locations: row.locations,
    remotePreference: row.remotePreference,
    employmentTypes: row.employmentTypes,
    categories: row.categories,
    fresherOnly: row.fresherOnly,
    includeUnknownExperience: row.includeUnknownExperience,
    salaryMin: row.salaryMin,
    salaryCurrency: row.salaryCurrency,
    graduationYear: row.graduationYear,
    timezone: row.timezone,
    instantMinScore: row.instantMinScore,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toPreferredRole(row: typeof preferredRoles.$inferSelect): PreferredRole {
  return {
    id: row.id,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    roleFamily: row.roleFamily,
    tier: row.tier,
    enabled: row.enabled,
  };
}
