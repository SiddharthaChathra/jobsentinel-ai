import {
  DIGEST_MAX_JOBS,
  TELEGRAM_MAX_CHARS,
  esc,
  formatDigest,
  formatInstant,
  formatSystemAlert,
  instantButtons,
  relativeTime,
  truncate,
  type JobAlertData,
} from './format';

const now = new Date('2026-09-22T12:00:00Z');

const job = (over: Partial<JobAlertData> = {}): JobAlertData => ({
  jobId: '11111111-1111-4111-8111-111111111111',
  title: 'Software Engineer',
  company: 'Razorpay',
  location: 'Bengaluru',
  isRemote: false,
  experienceText: '0–1 yrs',
  fresherEligible: true,
  score: 91,
  priority: 'VERY_HIGH',
  matchedSkills: ['Python', 'SQL', 'Linux'],
  missingSkills: ['Kubernetes'],
  companyVerified: true,
  applicationVerified: true,
  applicationUrl: 'https://jobs.lever.co/razorpay/abc',
  applicationHost: 'jobs.lever.co',
  postedAt: new Date('2026-09-22T10:00:00Z'),
  deadline: new Date('2026-09-30T00:00:00Z'),
  ...over,
});

describe('esc', () => {
  it('escapes every character Telegram HTML treats as markup', () => {
    expect(esc(`Dev & Ops <script>alert("x")</script> 'quoted'`)).toBe(
      'Dev &amp; Ops &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#39;quoted&#39;',
    );
  });
});

describe('formatInstant', () => {
  it('includes the match, the evidence and the trust line', () => {
    const text = formatInstant(job(), now);
    expect(text).toContain('🚨 <b>NEW FRESHER JOB</b> — Software Engineer');
    expect(text).toContain('🏢 Razorpay');
    expect(text).toContain('📍 Bengaluru');
    expect(text).toContain('🎯 Match 91% — Very High');
    expect(text).toContain('✓ Python ✓ SQL ✓ Linux');
    expect(text).toContain('✗ Kubernetes');
    expect(text).toContain('🛡 Company verified · Apply link verified · (jobs.lever.co)');
    expect(text).toContain('🕒 Posted 2 h ago');
    expect(text).toContain('Deadline: 30 Sep');
  });

  it('never claims verification the job does not have', () => {
    const text = formatInstant(job({ companyVerified: false, applicationVerified: false }), now);
    expect(text).toContain('Company unverified');
    expect(text).toContain('Apply link unconfirmed');
    expect(text).not.toContain('Company verified ·');
  });

  it('escapes employer-supplied text so a title cannot break the message', () => {
    const text = formatInstant(
      job({ title: 'Engineer <b>NOW</b> & more', company: 'A & B <Ltd>' }),
      now,
    );
    expect(text).toContain('Engineer &lt;b&gt;NOW&lt;/b&gt; &amp; more');
    expect(text).toContain('A &amp; B &lt;Ltd&gt;');
    expect(text).not.toMatch(/<b>NOW<\/b>/);
  });

  it('says Remote instead of a city for a remote job', () => {
    expect(formatInstant(job({ isRemote: true, location: null }), now)).toContain('📍 Remote');
  });

  it('omits optional lines rather than printing empty ones', () => {
    const text = formatInstant(
      job({
        experienceText: null,
        postedAt: null,
        deadline: null,
        matchedSkills: [],
        missingSkills: [],
      }),
      now,
    );
    expect(text).not.toContain('🕒');
    expect(text).not.toContain('Deadline');
    expect(text.split('\n').every((l) => l.trim().length > 0)).toBe(true);
  });
});

describe('instantButtons', () => {
  it('links APPLY to the verified application URL and View to the dashboard', () => {
    const rows = instantButtons(job(), 'https://app.example');
    expect(rows[0]![0]).toMatchObject({
      text: '🔗 APPLY NOW',
      url: 'https://jobs.lever.co/razorpay/abc',
    });
    expect(rows[0]![1]!.url).toBe('https://app.example/jobs/11111111-1111-4111-8111-111111111111');
    expect(rows[1]!.map((b) => b.callbackData)).toEqual([
      'save:11111111-1111-4111-8111-111111111111',
      'skip:11111111-1111-4111-8111-111111111111',
    ]);
  });
});

describe('formatDigest', () => {
  const digest = (jobs: JobAlertData[]) => ({
    dateLabel: 'Tue 22 Sep',
    counts: { veryHigh: 5, high: 12, medium: 8, other: 14, needsReview: 3 },
    jobs,
    expiredSinceYesterday: 4,
    failingSources: ['Adzuna'],
  });

  it('summarises counts, lists jobs and reports system trouble', () => {
    const text = formatDigest(digest([job(), job({ title: 'Backend Engineer', score: 80 })]));
    expect(text).toContain('📬 <b>JobSentinel Daily</b> — Tue 22 Sep');
    expect(text).toContain('🔥 Very High: 5');
    expect(text).toContain(
      '1. <a href="https://jobs.lever.co/razorpay/abc">Software Engineer</a> — Razorpay, Bengaluru — 91%',
    );
    expect(text).toContain('2. ');
    expect(text).toContain('Expired since yesterday: 4');
    expect(text).toContain('Sources failing: 1 (Adzuna)');
  });

  it('caps the list and says so implicitly by count', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      job({ title: `Role ${i}`, jobId: `id-${i}` }),
    );
    const text = formatDigest(digest(many));
    expect(text).toContain(`<b>Top ${DIGEST_MAX_JOBS}:</b>`);
    expect(text).toContain(`${DIGEST_MAX_JOBS}. `);
    expect(text).not.toContain(`${DIGEST_MAX_JOBS + 1}. `);
  });

  it('is honest when there is nothing to report', () => {
    const text = formatDigest({
      dateLabel: 'Tue 22 Sep',
      counts: { veryHigh: 0, high: 0, medium: 0, other: 0, needsReview: 0 },
      jobs: [],
      expiredSinceYesterday: 0,
      failingSources: [],
    });
    expect(text).toContain('No new matches today');
    expect(text).not.toContain('Expired since yesterday');
  });
});

describe('truncate', () => {
  it('leaves a short message alone', () => {
    expect(truncate('hello')).toBe('hello');
  });

  it('never exceeds the Telegram limit and prefers a line boundary', () => {
    const text = Array.from({ length: 500 }, (_, i) => `line ${i} with some padding text`).join(
      '\n',
    );
    const out = truncate(text);
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(out.endsWith('\n…')).toBe(true);
    // Cut on a boundary, so the last kept line is intact rather than half a line.
    const kept = out.slice(0, -2).split('\n');
    expect(kept[kept.length - 1]).toMatch(/^line \d+ with some padding text$/);
  });

  it('still truncates when there is no usable line break', () => {
    const out = truncate('x'.repeat(5000));
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
  });

  it('keeps a real digest of 15 jobs inside the limit', () => {
    const many = Array.from({ length: DIGEST_MAX_JOBS }, (_, i) =>
      job({
        title: `Senior Software Development Engineer II ${i}`,
        company: `Company With A Long Name ${i}`,
      }),
    );
    const text = formatDigest({
      dateLabel: 'Tue 22 Sep',
      counts: { veryHigh: 5, high: 12, medium: 8, other: 14, needsReview: 3 },
      jobs: many,
      expiredSinceYesterday: 4,
      failingSources: [],
    });
    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_CHARS);
    expect(text).not.toContain('…');
  });
});

describe('relativeTime', () => {
  it('reads naturally across the ranges', () => {
    expect(relativeTime(new Date('2026-09-22T11:59:40Z'), now)).toBe('just now');
    expect(relativeTime(new Date('2026-09-22T11:30:00Z'), now)).toBe('30 min ago');
    expect(relativeTime(new Date('2026-09-22T09:00:00Z'), now)).toBe('3 h ago');
    expect(relativeTime(new Date('2026-09-21T12:00:00Z'), now)).toBe('yesterday');
    expect(relativeTime(new Date('2026-09-19T12:00:00Z'), now)).toBe('3 days ago');
  });
});

describe('formatSystemAlert', () => {
  it('escapes its detail', () => {
    expect(formatSystemAlert('Source disabled', 'greenhouse <x> failed 3×')).toBe(
      '⚠️ <b>Source disabled</b>\ngreenhouse &lt;x&gt; failed 3×',
    );
  });
});
