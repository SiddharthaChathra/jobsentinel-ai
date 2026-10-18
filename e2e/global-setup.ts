import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { makeTextPdf } from '../apps/api/test/helpers/pdf';
import { loadTestEnv, TAG } from './test-env';
import { cleanUp } from './global-teardown';

const DAY = 86_400_000;

/**
 * Seeds the jobs the browser journey filters (F9). Deterministic fixtures, no sources, no AI
 * (no provider key: every AI step uses its rules fallback), no Telegram (no bot token). Every row
 * carries TAG so the teardown — and a re-run after a killed run — can remove exactly these.
 */
export default async function globalSetup(): Promise<void> {
  const env = loadTestEnv();
  await cleanUp(env);
  const sql = postgres(env.DATABASE_URL!, { max: 1 });
  try {
    const [company] = await sql<{ id: string }[]>`
      insert into companies (name, normalized_name, website_domain, verification_status)
      values (${`${TAG} Labs`}, ${`${TAG.toLowerCase()} labs`}, 'zorblax.example', 'VERIFIED')
      returning id`;
    const job = (
      title: string,
      o: {
        daysAgo: number;
        city?: string | null;
        country?: string | null;
        remote?: boolean;
        category?: string;
        salaryMin?: number | null;
      },
    ) => {
      const at = new Date(Date.now() - o.daysAgo * DAY);
      const disclosed = o.salaryMin != null;
      return sql`
        insert into jobs (company_id, title, normalized_title, category, description, source_url,
          application_url, final_application_url, dedupe_key, status, validation_status,
          experience_level, experience_min_years, fresher_eligible, employment_type,
          location_city, location_country, location_text, is_remote, posted_at, first_seen_at,
          salary_min, salary_max, salary_currency, salary_period, salary_disclosed)
        values (${company!.id}, ${title}, ${title.toLowerCase()}, ${o.category ?? 'SOFTWARE'},
          ${`${TAG} fixture. Freshers welcome, 0 years of experience. Java and SQL.`},
          ${`https://zorblax.example/jobs/${encodeURIComponent(title)}`},
          ${`https://zorblax.example/jobs/${encodeURIComponent(title)}/apply`},
          ${`https://zorblax.example/jobs/${encodeURIComponent(title)}/apply`},
          ${`${TAG}-${title}`}, 'VALID', 'VALID', 'FRESHER', 0, true, 'FULL_TIME',
          ${o.city ?? null}, ${o.country ?? null},
          ${[o.city, o.country].filter(Boolean).join(', ') || (o.remote ? 'Remote' : null)},
          ${o.remote ?? false}, ${at}, ${at},
          ${o.salaryMin ?? null}, ${o.salaryMin != null ? o.salaryMin * 1.5 : null},
          ${disclosed ? 'INR' : null}, ${disclosed ? 'YEAR' : null}, ${disclosed})`;
    };
    // Listed: India, disclosed ₹6 L; remote abroad (D102), undisclosed; India network role, 20 days old, ₹3 L.
    await job(`${TAG} Graduate Software Engineer`, {
      daysAgo: 2,
      city: 'Bengaluru',
      country: 'India',
      salaryMin: 600_000,
    });
    await job(`${TAG} Remote Backend Trainee`, {
      daysAgo: 3,
      country: 'United States',
      remote: true,
    });
    await job(`${TAG} Network Engineer Trainee`, {
      daysAgo: 20,
      city: 'Pune',
      country: 'India',
      category: 'NETWORK',
      salaryMin: 300_000,
    });
    // Never listed: on-site abroad, and older than the 60-day window.
    await job(`${TAG} Onsite Austin Engineer`, {
      daysAgo: 1,
      city: 'Austin',
      country: 'United States',
    });
    await job(`${TAG} Stale Trainee`, { daysAgo: 70, city: 'Chennai', country: 'India' });
  } finally {
    await sql.end();
  }

  const dir = resolve(__dirname, 'fixtures/.generated');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'resume.pdf'),
    makeTextPdf([
      'Asha Test',
      'B.E. Computer Science, 2027',
      'Skills: Java, Python, SQL, React, Git, Linux',
      'Projects: Built a REST API with Spring Boot and PostgreSQL',
      'Internship: Software engineering intern, 3 months',
    ]),
  );
}
