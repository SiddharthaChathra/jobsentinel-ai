import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExperienceLevel } from '@jobsentinel/types';
import { classifyCategory, classifyExperience } from '@jobsentinel/validation';

interface Fixture {
  title: string;
  experienceText: string | null;
  employmentType: string | null;
  description: string;
  expectedLevels: ExperienceLevel[];
  expectedEngineering: boolean;
  source: 'live' | 'authored';
}

/**
 * Accuracy gate for the deterministic classifiers (docs 16, Phase 5 definition of done).
 * 60 postings sampled from real ATS boards ingested in Phase 4 + 12 authored fresher-path cases,
 * hand-labelled. `UNKNOWN` is an accepted answer only where the posting genuinely does not say —
 * the rules are allowed to abstain, not to guess.
 */
const fixtures = JSON.parse(
  readFileSync(join(__dirname, '../../test/fixtures/jobs/labelled.json'), 'utf8'),
) as Fixture[];

describe('classification accuracy on labelled postings', () => {
  const results = fixtures.map((f) => {
    const level = classifyExperience({
      title: f.title,
      experienceText: f.experienceText,
      description: f.description,
      employmentType: f.employmentType,
    });
    const category = classifyCategory({ title: f.title });
    return {
      f,
      level,
      category,
      levelOk: f.expectedLevels.includes(level.level),
      engOk: category.isEngineering === f.expectedEngineering,
    };
  });

  it('has a meaningful, balanced fixture set', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(60);
    expect(
      fixtures.filter((f) => f.expectedLevels.includes('FRESHER')).length,
    ).toBeGreaterThanOrEqual(15);
    expect(fixtures.filter((f) => f.expectedEngineering).length).toBeGreaterThanOrEqual(25);
  });

  it('agrees with the labels on experience level at least 90% of the time', () => {
    const wrong = results.filter((r) => !r.levelOk);
    if (wrong.length > 0) {
      console.warn(
        'level mismatches:\n' +
          wrong
            .map(
              (r) => `  ${r.f.title} → ${r.level.level} (expected ${r.f.expectedLevels.join('|')})`,
            )
            .join('\n'),
      );
    }
    expect(results.filter((r) => r.levelOk).length / results.length).toBeGreaterThanOrEqual(0.9);
  });

  it('agrees with the labels on engineering vs non-engineering at least 90% of the time', () => {
    const wrong = results.filter((r) => !r.engOk);
    if (wrong.length > 0) {
      console.warn(
        'category mismatches:\n' +
          wrong
            .map(
              (r) =>
                `  ${r.f.title} → ${r.category.category} (expected engineering=${r.f.expectedEngineering})`,
            )
            .join('\n'),
      );
    }
    expect(results.filter((r) => r.engOk).length / results.length).toBeGreaterThanOrEqual(0.9);
  });

  it('never calls a clearly senior posting fresher-eligible (the costly error)', () => {
    const falsePositives = results.filter(
      (r) =>
        r.f.expectedLevels.length === 1 &&
        r.f.expectedLevels[0] === 'EXPERIENCED' &&
        r.level.fresherEligible === true,
    );
    expect(falsePositives.map((r) => r.f.title)).toEqual([]);
  });

  it('flags ambiguous postings for AI instead of guessing', () => {
    const abstained = results.filter((r) => r.level.level === 'UNKNOWN');
    expect(abstained.every((r) => r.level.needsAi)).toBe(true);
    // Abstention must stay rare, or the AI budget is wasted on the whole board.
    expect(abstained.length / results.length).toBeLessThan(0.25);
  });

  it('every verdict carries evidence a human can read', () => {
    const decided = results.filter((r) => r.level.level !== 'UNKNOWN');
    expect(decided.every((r) => r.level.evidence.length > 0)).toBe(true);
  });
});
