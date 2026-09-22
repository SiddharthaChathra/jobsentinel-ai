import {
  EXPERIENCED_BODY_PATTERNS,
  FRESHER_BODY_PATTERNS,
  FRESHER_TITLE_PATTERNS,
  SENIOR_TITLE_PATTERNS,
} from '@jobsentinel/config';
import type { ExperienceLevel } from '@jobsentinel/types';
import { parseExperience } from '../normalize/fields';

export interface ExperienceEvidence {
  code: string;
  detail: string;
  weight: 'POSITIVE' | 'NEGATIVE';
}

export interface ExperienceClassification {
  level: ExperienceLevel;
  fresherEligible: boolean | null;
  confidence: number;
  minYears: number | null;
  maxYears: number | null;
  experienceText: string | null;
  evidence: ExperienceEvidence[];
  /** True when rules alone cannot decide — the caller may ask the AI (docs 09 §4). */
  needsAi: boolean;
}

export interface ExperienceInput {
  title: string;
  /** Source-provided experience field, when the adapter had one. */
  experienceText?: string | null;
  description?: string | null;
  employmentType?: string | null;
}

const MAX_BODY_SCAN = 8000;

/**
 * Deterministic experience/fresher classification (docs 09 §4).
 * Never decides on keywords alone: parsed year ranges outrank title tokens, conflicting signals
 * produce UNKNOWN with `needsAi`, and every verdict carries its evidence.
 */
export function classifyExperience(input: ExperienceInput): ExperienceClassification {
  const title = input.title.trim();
  const body = (input.description ?? '').slice(0, MAX_BODY_SCAN);
  const evidence: ExperienceEvidence[] = [];

  const seniorTitle = SENIOR_TITLE_PATTERNS.find((p) => p.test(title));
  if (seniorTitle)
    evidence.push({
      code: 'SENIOR_TITLE',
      detail: matchOf(title, seniorTitle),
      weight: 'NEGATIVE',
    });

  const fresherTitle = FRESHER_TITLE_PATTERNS.find((p) => p.test(title));
  if (fresherTitle)
    evidence.push({
      code: 'FRESHER_TITLE',
      detail: matchOf(title, fresherTitle),
      weight: 'POSITIVE',
    });

  const isInternship = /\bintern(ship)?\b/i.test(title) || input.employmentType === 'INTERNSHIP';
  if (isInternship) evidence.push({ code: 'INTERNSHIP', detail: 'internship', weight: 'POSITIVE' });

  const years = parseExperience(input.experienceText, title, body);
  if (years.text) {
    evidence.push({
      code: 'YEARS_PARSED',
      detail: `${years.text} → [${years.minYears ?? '?'}, ${years.maxYears ?? '?'}]`,
      weight: (years.minYears ?? 0) >= 2 ? 'NEGATIVE' : 'POSITIVE',
    });
  }

  for (const p of FRESHER_BODY_PATTERNS) {
    const m = matchOf(body, p);
    if (m) {
      evidence.push({ code: 'FRESHER_PHRASE', detail: m, weight: 'POSITIVE' });
      break;
    }
  }
  for (const p of EXPERIENCED_BODY_PATTERNS) {
    const m = matchOf(body, p);
    if (m) {
      evidence.push({ code: 'EXPERIENCE_REQUIRED', detail: m, weight: 'NEGATIVE' });
      break;
    }
  }

  const positives = evidence.filter((e) => e.weight === 'POSITIVE');
  const negatives = evidence.filter((e) => e.weight === 'NEGATIVE');
  const min = years.minYears;
  const max = years.maxYears;

  const done = (
    level: ExperienceLevel,
    confidence: number,
    needsAi = false,
  ): ExperienceClassification => ({
    level,
    fresherEligible:
      level === 'FRESHER' || level === 'ENTRY_LEVEL'
        ? true
        : level === 'EXPERIENCED'
          ? false
          : null,
    confidence,
    minYears: min,
    maxYears: max,
    experienceText: years.text,
    evidence,
    needsAi,
  });

  // 1. A parsed requirement of 3+ years is decisive regardless of the title.
  if (min !== null && min >= 3) return done('EXPERIENCED', 0.95);
  // 2. An internship outranks every seniority word in the title ("Product Management Intern").
  if (isInternship) return done('FRESHER', 0.9);
  // 3. A senior title next to fresher signals is contradictory — never guess, ask the AI.
  if (
    seniorTitle &&
    (positives.some((e) => e.code === 'FRESHER_PHRASE') || (max !== null && max <= 2))
  ) {
    return done('UNKNOWN', 0.4, true);
  }
  // 4. Otherwise a senior-ish title is decisive.
  if (seniorTitle) return done('EXPERIENCED', min !== null && min >= 2 ? 0.95 : 0.85);
  // 4. Explicit 0–1 (or 0–2 with a fresher signal) → FRESHER.
  if (max !== null && max <= 1) return done('FRESHER', 0.9);
  if (min !== null && min === 0 && max !== null && max <= 2)
    return done(positives.length > 1 ? 'FRESHER' : 'ENTRY_LEVEL', 0.85);
  // 5. Title/body says fresher and nothing contradicts it.
  if (positives.length > 0 && negatives.length === 0)
    return done('FRESHER', fresherTitle ? 0.85 : 0.75);
  // 6. 1–3 years, or a junior-ish signal with mild experience → ENTRY_LEVEL.
  if (min !== null && min <= 1 && (max === null || max <= 3)) return done('ENTRY_LEVEL', 0.75);
  if (min !== null && min === 2)
    return done(negatives.length > 1 ? 'EXPERIENCED' : 'ENTRY_LEVEL', 0.65);
  // 7. Experience demanded in the body without a parsed range.
  if (negatives.length > 0 && positives.length === 0) return done('EXPERIENCED', 0.7);
  // 8. Conflicting or absent signals — ask the AI, keep the job visible meanwhile.
  return done('UNKNOWN', positives.length || negatives.length ? 0.4 : 0.3, true);
}

function matchOf(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  return m ? m[0].trim().slice(0, 80) : '';
}
