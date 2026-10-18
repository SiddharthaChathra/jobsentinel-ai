import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadTestEnv, TAG } from '../test-env';

/**
 * One user's journey through the real web app and API on the local stack (F9): sign up, onboard
 * with a resume, filter the job list (India, domain, salary, recency), and track an application
 * that survives a reload. Serial: each step builds on the last, in one browser page.
 */
test.describe.configure({ mode: 'serial' });

const email = `${TAG.toLowerCase()}-${Date.now()}@jobsentinel.test`;
const password = `Zb-${Math.random().toString(36).slice(2, 10)}-Pass1!`;
const JOBS = {
  india: `${TAG} Graduate Software Engineer`,
  remoteAbroad: `${TAG} Remote Backend Trainee`,
  network: `${TAG} Network Engineer Trainee`,
  onsiteAbroad: `${TAG} Onsite Austin Engineer`,
  stale: `${TAG} Stale Trainee`,
};

let page: Page;
const card = (title: string) => page.getByRole('link', { name: title, exact: true });

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test('sign-up creates an account and opens onboarding', async () => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByTestId('signup-submit').click();
  await expect(page).toHaveURL(/\/onboarding/);
});

test('onboarding with a resume fixture reaches the dashboard', async () => {
  await page
    .locator('input[type="file"]')
    .setInputFiles(resolve(__dirname, '../fixtures/.generated/resume.pdf'));
  await page.getByTestId('onboarding-upload').click();
  // No AI key in tests: the profile comes from the deterministic parser.
  await expect(page.getByText('Check what we found')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Skills' })).toContainText('Java');
  await page.getByTestId('onboarding-confirm-profile').click();
  await page.getByTestId('onboarding-start').click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
});

test('job list: India and remote jobs listed; on-site abroad and stale jobs never', async () => {
  await page.goto(`/jobs?q=${TAG}`);
  await expect(card(JOBS.india)).toBeVisible();
  await expect(card(JOBS.remoteAbroad)).toBeVisible();
  await expect(card(JOBS.network)).toBeVisible();
  await expect(card(JOBS.onsiteAbroad)).toHaveCount(0);
  await expect(card(JOBS.stale)).toHaveCount(0);
});

test('domain filter: category=NETWORK shows only the network role', async () => {
  await page.goto(`/jobs?q=${TAG}&category=NETWORK`);
  await expect(card(JOBS.network)).toBeVisible();
  await expect(card(JOBS.india)).toHaveCount(0);
  await expect(card(JOBS.remoteAbroad)).toHaveCount(0);
});

test('recency filter: "Last 7 days" drops the 20-day-old job; nothing older than 60 days ever shows', async () => {
  await page.goto(`/jobs?q=${TAG}`);
  await expect(card(JOBS.network)).toBeVisible();
  await page.getByTestId('filter-posted').click();
  await page.getByRole('option', { name: 'Last 7 days' }).click();
  await expect(page).toHaveURL(/postedAfter=/);
  await expect(card(JOBS.network)).toHaveCount(0);
  await expect(card(JOBS.india)).toBeVisible();
  await expect(card(JOBS.stale)).toHaveCount(0);
});

test('salary filter: minimum hides lower pay; "include undisclosed" toggles jobs without a salary', async () => {
  await page.goto(`/jobs?q=${TAG}`);
  await page.getByTestId('salary-min-input').fill('500000');
  await expect(page).toHaveURL(/salaryMin=500000/);
  await expect(card(JOBS.india)).toBeVisible(); // ₹6 L
  await expect(card(JOBS.network)).toHaveCount(0); // ₹3 L
  await expect(card(JOBS.remoteAbroad)).toBeVisible(); // not stated, included by default
  // The box is controlled by the URL: it flips once the router has updated the query, so click
  // and wait for the URL rather than expecting the state to change synchronously.
  const toggle = page.getByTestId('salary-undisclosed-toggle');
  await toggle.click();
  await expect(page).toHaveURL(/includeUndisclosedSalary=false/);
  await expect(toggle).not.toBeChecked();
  await expect(card(JOBS.remoteAbroad)).toHaveCount(0);
  await expect(card(JOBS.india)).toBeVisible();
  // A job without a salary still says so: "Not disclosed", never blank (R6).
  await toggle.click();
  await expect(page).not.toHaveURL(/includeUndisclosedSalary/);
  await expect(toggle).toBeChecked();
  await expect(page.getByText('Not disclosed').first()).toBeVisible();
});

test('tracker: mark Applied, reload, the status persists and there is exactly one tracker row', async () => {
  await page.goto(`/jobs?q=${TAG}`);
  await card(JOBS.india).click();
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}/);
  const status = page.getByTestId('tracker-status');
  await status.click();
  // Listen before clicking, so a fast PUT cannot finish before we start waiting for it.
  const saved = page.waitForResponse(
    (r) => r.url().includes('/applications/') && r.request().method() === 'PUT' && r.ok(),
  );
  await page.getByRole('option', { name: 'Applied' }).click();
  await saved;
  await expect(status).toHaveText(/Applied/);

  await page.reload();
  await expect(page.getByTestId('tracker-status')).toHaveText(/Applied/);

  await page.goto('/applications');
  await expect(page.getByText(JOBS.india)).toBeVisible();

  const env = loadTestEnv();
  const sql = postgres(env.DATABASE_URL!, { max: 1 });
  try {
    const rows = await sql<{ status: string }[]>`
      select a.status from applications a
      join users u on u.id = a.user_id join jobs j on j.id = a.job_id
      where u.email = ${email} and j.title = ${JOBS.india}`;
    expect(rows).toEqual([{ status: 'APPLIED' }]);
  } finally {
    await sql.end();
  }
});
