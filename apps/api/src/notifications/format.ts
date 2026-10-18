import type { MatchScoring, PriorityBand, SourceAttribution } from '@jobsentinel/types';
import type { InlineButton } from './telegram.client';

/** Telegram hard-limits a message to 4096 characters. */
export const TELEGRAM_MAX_CHARS = 4096;
/** A digest lists at most this many jobs; the rest live behind the dashboard link (docs 10 §3). */
export const DIGEST_MAX_JOBS = 15;

export interface JobAlertData {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  isRemote: boolean;
  experienceText: string | null;
  fresherEligible: boolean | null;
  salaryText: string | null;
  salaryDisclosed: boolean;
  score: number;
  priority: PriorityBand;
  /** RULES_ONLY is said in the alert (F8, D112). Optional: older queued snapshots lack it. */
  scoring?: MatchScoring;
  /** Provider credit the advert must carry, e.g. Adzuna's (D115). */
  attribution?: SourceAttribution | null;
  matchedSkills: string[];
  missingSkills: string[];
  companyVerified: boolean;
  applicationVerified: boolean;
  applicationUrl: string;
  sourceUrl: string;
  applicationHost: string | null;
  postedAt: Date | null;
  deadline: Date | null;
}

export interface DigestData {
  dateLabel: string;
  counts: { veryHigh: number; high: number; medium: number; other: number; needsReview: number };
  jobs: JobAlertData[];
  expiredSinceYesterday: number;
  failingSources: string[];
}

const BAND_LABEL: Record<PriorityBand, string> = {
  VERY_HIGH: 'Very High',
  HIGH: 'High',
  MEDIUM: 'Medium',
  OTHER: 'Other',
};

/**
 * Escapes the five characters Telegram's HTML parse mode treats as markup. Every piece of job
 * text is employer-supplied, so it is escaped without exception — an unescaped `<` in a title
 * silently truncates the whole message.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Instant alert body (docs 10 §3). */
export function formatInstant(
  job: JobAlertData,
  now: Date = new Date(),
  fallbackNote = false,
): string {
  const lines: string[] = [];
  lines.push(`🚨 <b>NEW FRESHER JOB</b> — ${esc(job.title)}`);

  const facts = [`🏢 ${esc(job.company)}`];
  const place = job.isRemote ? 'Remote' : job.location;
  if (place) facts.push(`📍 ${esc(place)}`);
  if (job.salaryDisclosed && job.salaryText) facts.push(`💰 ${esc(job.salaryText)}`);
  else facts.push(`💰 Not disclosed`);
  if (job.experienceText) facts.push(`🧑‍🎓 ${esc(job.experienceText)}`);
  if (job.fresherEligible) facts.push('Fresher ✓');
  lines.push(facts.join(' · '));

  lines.push(
    `🎯 Match ${job.score}% — ${BAND_LABEL[job.priority]}${job.scoring === 'RULES_ONLY' ? ' · rules only' : ''}`,
  );

  const skills: string[] = [];
  if (job.matchedSkills.length)
    skills.push(
      job.matchedSkills
        .slice(0, 6)
        .map((s) => `✓ ${esc(s)}`)
        .join(' '),
    );
  if (job.missingSkills.length)
    skills.push(
      job.missingSkills
        .slice(0, 3)
        .map((s) => `✗ ${esc(s)}`)
        .join(' '),
    );
  if (skills.length) lines.push(skills.join(' · '));

  // The trust line is the whole point of the validation phase — never omit it.
  const trust: string[] = [];
  trust.push(job.companyVerified ? '🛡 Company verified' : '🛡 Company unverified');
  trust.push(job.applicationVerified ? 'Apply link verified' : 'Apply link unconfirmed');
  if (job.applicationHost) trust.push(`(${esc(job.applicationHost)})`);
  lines.push(trust.join(' · '));

  const timing: string[] = [];
  if (job.postedAt) timing.push(`🕒 Posted ${relativeTime(job.postedAt, now)}`);
  if (job.deadline) timing.push(`Deadline: ${formatDay(job.deadline)}`);
  if (timing.length) lines.push(timing.join(' · '));
  // The provider's required credit, linked to its site (D115).
  if (job.attribution) {
    lines.push(`Jobs by <a href="${esc(job.attribution.url)}">${esc(job.attribution.label)}</a>`);
  }

  if (fallbackNote) {
    lines.push(
      `\n⚠️ <i>Direct apply link was unreachable. The button below will take you to the original source listing.</i>`,
    );
  }

  return truncate(lines.join('\n'));
}

export function instantButtons(job: JobAlertData, dashboardUrl: string): InlineButton[][] {
  const top: InlineButton[] = [{ text: '🔗 APPLY NOW', url: encodeURI(job.applicationUrl) }];
  // Telegram rejects a keyboard containing a non-public URL and drops the entire message, so a
  // local dashboard costs us the View button rather than the whole alert (D56).
  if (isPublicUrl(dashboardUrl)) {
    top.push({ text: '📊 View', url: `${dashboardUrl}/jobs/${job.jobId}` });
  }
  return [
    top,
    [
      { text: '⭐ Save', callbackData: `save:${job.jobId}` },
      { text: '🚫 Not interested', callbackData: `skip:${job.jobId}` },
    ],
  ];
}

/** Telegram only accepts publicly reachable http(s) button URLs — not localhost or a bare IP. */
export function isPublicUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return false;
    return host.includes('.');
  } catch {
    return false;
  }
}

/** Daily digest body (docs 10 §3). */
export function formatDigest(digest: DigestData): string {
  const c = digest.counts;
  const lines: string[] = [];
  lines.push(`📬 <b>JobSentinel Daily</b> — ${esc(digest.dateLabel)}`);
  lines.push(
    `🔥 Very High: ${c.veryHigh} · 🟢 High: ${c.high} · 🟡 Medium: ${c.medium} · ⚪ Other: ${c.other} · 🔎 Needs review: ${c.needsReview}`,
  );

  if (digest.jobs.length === 0) {
    lines.push('');
    lines.push('No new matches today. The scanners are still running.');
  } else {
    lines.push('');
    lines.push(`<b>Top ${Math.min(digest.jobs.length, DIGEST_MAX_JOBS)}:</b>`);
    digest.jobs.slice(0, DIGEST_MAX_JOBS).forEach((j, i) => {
      const place = j.isRemote ? 'Remote' : (j.location ?? '—');
      lines.push(
        `${i + 1}. <a href="${esc(j.applicationUrl)}">${esc(j.title)}</a> — ${esc(j.company)}, ${esc(place)} — ${j.score}%${
          j.attribution
            ? ` · via <a href="${esc(j.attribution.url)}">${esc(j.attribution.label)}</a>`
            : ''
        }`,
      );
    });
  }

  const footer: string[] = [];
  if (digest.expiredSinceYesterday > 0)
    footer.push(`Expired since yesterday: ${digest.expiredSinceYesterday}`);
  if (digest.failingSources.length > 0) {
    footer.push(
      `Sources failing: ${digest.failingSources.length} (${digest.failingSources.slice(0, 3).map(esc).join(', ')})`,
    );
  }
  if (footer.length) {
    lines.push('');
    lines.push(footer.join(' · '));
  }
  return truncate(lines.join('\n'));
}

/** The weekly summary's content (F6, D121). */
export interface WeeklyData {
  rangeLabel: string;
  newJobs: { total: number; byPriority: Record<'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'OTHER', number> };
  topJobs: { title: string; company: string; score: number }[];
  applications: { applied: number; statusChanges: Record<string, number> };
  upcoming: { total: number; items: string[] };
  skillGaps: { skill: string; missingIn: number; of: number }[];
  sources: { paused: string[]; failing: string[] };
}

const STATUS_LABEL: Record<string, string> = {
  APPLIED: 'applied',
  INTERVIEW: 'interview',
  SELECTED: 'selected',
  REJECTED: 'rejected',
  NOT_INTERESTED: 'not interested',
};

/** Weekly summary for Telegram (F6, D121). Every employer-supplied string is escaped (D56). */
export function formatWeekly(w: WeeklyData): string {
  const p = w.newJobs.byPriority;
  const lines: string[] = [`🗓️ <b>JobSentinel Weekly</b> — ${esc(w.rangeLabel)}`, ''];
  lines.push(
    `<b>New valid jobs: ${w.newJobs.total}</b> — 🔥 ${p.VERY_HIGH} · 🟢 ${p.HIGH} · 🟡 ${p.MEDIUM} · ⚪ ${p.OTHER}`,
  );
  for (const j of w.topJobs) lines.push(`• ${esc(j.title)} — ${esc(j.company)} (${j.score}%)`);

  const changes = Object.entries(w.applications.statusChanges)
    .filter(([s]) => s !== 'APPLIED')
    .map(([s, n]) => `${n} ${STATUS_LABEL[s] ?? s.toLowerCase()}`);
  lines.push('');
  lines.push(
    `<b>Applications:</b> ${w.applications.applied} sent${changes.length ? ` · ${changes.join(' · ')}` : ''}`,
  );

  lines.push('');
  if (w.upcoming.total === 0) lines.push('<b>Coming up:</b> nothing scheduled');
  else {
    lines.push(`<b>Coming up (${w.upcoming.total}):</b>`);
    for (const item of w.upcoming.items) lines.push(`• ${esc(item)}`);
  }

  if (w.skillGaps.length) {
    lines.push('');
    lines.push(
      `<b>Top skill gaps:</b> ${w.skillGaps
        .map((g) => `${esc(g.skill)} (${g.missingIn}/${g.of})`)
        .join(' · ')}`,
    );
  }

  const health: string[] = [];
  if (w.sources.paused.length)
    health.push(
      `paused: ${w.sources.paused.slice(0, 3).map(esc).join(', ')}${w.sources.paused.length > 3 ? '…' : ''}`,
    );
  if (w.sources.failing.length)
    health.push(
      `failing: ${w.sources.failing.slice(0, 3).map(esc).join(', ')}${w.sources.failing.length > 3 ? '…' : ''}`,
    );
  if (health.length) {
    lines.push('');
    lines.push(`<b>Sources</b> — ${health.join(' · ')}`);
  }
  return truncate(lines.join('\n'));
}

/** A tracker reminder (F5, D119). Job titles in `detail` are escaped like everything else. */
export function formatReminder(title: string, detail: string): string {
  return truncate(`⏰ <b>${esc(title)}</b>\n${esc(detail)}`);
}

export function formatSystemAlert(title: string, detail: string): string {
  return truncate(`⚠️ <b>${esc(title)}</b>\n${esc(detail)}`);
}

/**
 * Trims to Telegram's limit on a line boundary where possible, so a message is never cut
 * mid-tag (which would make Telegram reject the whole thing as malformed HTML).
 */
export function truncate(text: string, max = TELEGRAM_MAX_CHARS): string {
  if (text.length <= max) return text;
  const suffix = '\n…';
  const body = text.slice(0, max - suffix.length);
  const lastBreak = body.lastIndexOf('\n');
  return (lastBreak > max * 0.5 ? body.slice(0, lastBreak) : body) + suffix;
}

export function relativeTime(at: Date, now: Date = new Date()): string {
  const mins = Math.round((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function formatDay(at: Date): string {
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
