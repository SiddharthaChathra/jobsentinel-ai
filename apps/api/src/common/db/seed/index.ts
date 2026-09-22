import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertEnv, loadEnv, SCAN_INTERVAL_SEC, SKILL_DICTIONARY } from '@jobsentinel/config';
import { normalizeCompanyName } from '@jobsentinel/validation';
import { normalizeSkillName } from '../../../users/profiles.service';
import { companies, jobSources, skills } from '../schema';
import * as schema from '../schema';
import { STARTER_SOURCES } from './starter-sources';

/**
 * Idempotent seed (docs 02 §7): skill dictionary + starter sources (+ their companies).
 * Safe to re-run; existing rows are updated by natural key, user edits to `enabled`/`priority`
 * on sources are preserved (only metadata/config are refreshed).
 */
export async function seed(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<{ skills: number; companies: number; sources: number }> {
  let skillCount = 0;
  for (const s of SKILL_DICTIONARY) {
    await db
      .insert(skills)
      .values({
        name: s.name,
        normalizedName: normalizeSkillName(s.name),
        category: s.category,
        aliases: s.aliases ?? [],
      })
      .onConflictDoUpdate({
        target: skills.normalizedName,
        set: {
          name: s.name,
          category: s.category,
          aliases: s.aliases ?? [],
          updatedAt: new Date(),
        },
      });
    skillCount++;
  }

  let companyCount = 0;
  let sourceCount = 0;
  // Stagger initial scans so the first worker tick does not hit every board at once (docs 07 §1.3).
  let stagger = 0;
  for (const src of STARTER_SOURCES) {
    let companyId: string | null = null;
    if (src.company) {
      const [row] = await db
        .insert(companies)
        .values({
          name: src.company.name,
          normalizedName: normalizeCompanyName(src.company.name),
          websiteDomain: src.company.domain,
          atsProvider: src.adapter,
          atsSlug: String(Object.values(src.config)[0]),
          careersUrl: careersUrlFor(src),
          isTrusted: true, // hand-picked in the seed → trusted (docs 08 §3.2)
        })
        .onConflictDoUpdate({
          target: companies.normalizedName,
          set: {
            websiteDomain: src.company.domain,
            atsProvider: src.adapter,
            atsSlug: String(Object.values(src.config)[0]),
            careersUrl: careersUrlFor(src),
            updatedAt: new Date(),
          },
        })
        .returning({ id: companies.id });
      companyId = row?.id ?? null;
      companyCount++;
    }

    const interval = SCAN_INTERVAL_SEC[src.priority];
    await db
      .insert(jobSources)
      .values({
        name: src.name,
        type: src.type,
        adapter: src.adapter,
        config: src.config,
        companyId,
        enabled: src.enabled ?? true,
        priority: src.priority,
        scanIntervalSec: interval,
        nextScanAt: sql`now() + (${stagger} * interval '20 seconds')`,
      })
      .onConflictDoUpdate({
        target: jobSources.name,
        set: {
          type: src.type,
          adapter: src.adapter,
          config: src.config,
          companyId,
          updatedAt: new Date(),
        },
      });
    stagger++;
    sourceCount++;
  }
  return { skills: skillCount, companies: companyCount, sources: sourceCount };
}

function careersUrlFor(src: (typeof STARTER_SOURCES)[number]): string | null {
  const slug = String(Object.values(src.config)[0]);
  switch (src.adapter) {
    case 'greenhouse':
      return `https://boards.greenhouse.io/${slug}`;
    case 'lever':
      return `https://jobs.lever.co/${slug}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${slug}`;
    default:
      return null;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  assertEnv(env, ['DATABASE_DIRECT_URL']);
  const client = postgres(env.DATABASE_DIRECT_URL, { ssl: 'require', max: 1, prepare: false });
  try {
    const db = drizzle(client, { schema });
    const result = await seed(db);
    const totals = await db
      .select({ n: sql<number>`count(*)` })
      .from(jobSources)
      .where(eq(jobSources.enabled, true));
    console.warn(
      `seeded: ${result.skills} skills, ${result.companies} companies, ${result.sources} sources (${totals[0]?.n ?? 0} enabled)`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
