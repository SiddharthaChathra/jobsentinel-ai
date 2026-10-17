import { allowedUnderPriority, AI_PURPOSE_PRIORITY } from './budget-priority';
import {
  buildCategoryClassifyRequest,
  categoryVerdict,
  CATEGORY_CONFIDENCE_FLOOR,
} from './prompts/category-classify.v1';
import { InMemoryBudget } from './ai-service';

const budget = { calls: 500, tokens: 1_500_000 };
const at = (calls: number, tokens = 0) => ({ calls, tokens });

describe('allowedUnderPriority (F8, D105)', () => {
  it('orders purposes: resume, fresher, matching, other, category last', () => {
    expect(AI_PURPOSE_PRIORITY.RESUME_PROFILE).toBeLessThan(AI_PURPOSE_PRIORITY.FRESHER_CLASSIFY);
    expect(AI_PURPOSE_PRIORITY.FRESHER_CLASSIFY).toBeLessThan(AI_PURPOSE_PRIORITY.MATCH);
    expect(AI_PURPOSE_PRIORITY.MATCH).toBeLessThan(AI_PURPOSE_PRIORITY.CATEGORY_CLASSIFY);
    for (const p of Object.keys(AI_PURPOSE_PRIORITY) as (keyof typeof AI_PURPOSE_PRIORITY)[]) {
      expect(AI_PURPOSE_PRIORITY[p]).toBeLessThanOrEqual(AI_PURPOSE_PRIORITY.CATEGORY_CLASSIFY);
    }
  });

  it('stops the category check first as the day fills up', () => {
    expect(allowedUnderPriority('CATEGORY_CLASSIFY', at(299), budget)).toBe(true);
    expect(allowedUnderPriority('CATEGORY_CLASSIFY', at(300), budget)).toBe(false); // 60%
    expect(allowedUnderPriority('MATCH', at(300), budget)).toBe(true);
    expect(allowedUnderPriority('MATCH', at(400), budget)).toBe(false); // 80%
    expect(allowedUnderPriority('FRESHER_CLASSIFY', at(449), budget)).toBe(true);
    expect(allowedUnderPriority('FRESHER_CLASSIFY', at(450), budget)).toBe(false); // 90%
  });

  it('never starves resume parsing: it may use the whole budget', () => {
    expect(allowedUnderPriority('RESUME_PROFILE', at(499), budget)).toBe(true);
    expect(allowedUnderPriority('RESUME_PROFILE', at(500), budget)).toBe(false);
  });

  it('applies the same ceilings to tokens', () => {
    expect(allowedUnderPriority('CATEGORY_CLASSIFY', at(1, 900_000), budget)).toBe(false);
    expect(allowedUnderPriority('RESUME_PROFILE', at(1, 900_000), budget)).toBe(true);
  });

  it('InMemoryBudget follows the same order', async () => {
    const b = new InMemoryBudget(10);
    for (let i = 0; i < 6; i++) await b.record({ status: 'OK' } as never);
    expect(await b.canSpend('CATEGORY_CLASSIFY')).toBe(false);
    expect(await b.canSpend('MATCH')).toBe(true);
    expect(await b.canSpend('RESUME_PROFILE')).toBe(true);
  });
});

describe('category-classify.v1 (A, D105)', () => {
  it('marks a short board description as a preview, and caches per canonical job', () => {
    const preview = buildCategoryClassifyRequest({
      jobId: 'job-1',
      title: 'Software Engineers',
      description: 'We are hiring. Apply now.',
    });
    expect(preview.user).toContain('<PREVIEW>true</PREVIEW>');
    expect(preview.purpose).toBe('CATEGORY_CLASSIFY');
    expect(preview.cacheKeyInput).toEqual({ jobId: 'job-1' });
    const full = buildCategoryClassifyRequest({
      jobId: 'job-2',
      title: 'Engineer',
      description: 'x'.repeat(2_000),
    });
    expect(full.user).toContain('<PREVIEW>false</PREVIEW>');
    expect(preview.system).toMatch(/answer "UNKNOWN"/);
  });

  it('places a confident answer and holds an unsure or unknown one', () => {
    expect(categoryVerdict({ category: 'SOFTWARE', confidence: 0.9, evidence: [] })).toEqual({
      placed: true,
      category: 'SOFTWARE',
    });
    expect(
      categoryVerdict({
        category: 'SOFTWARE',
        confidence: CATEGORY_CONFIDENCE_FLOOR - 0.01,
        evidence: [],
      }),
    ).toEqual({ placed: false });
    expect(categoryVerdict({ category: 'UNKNOWN', confidence: 0.99, evidence: [] })).toEqual({
      placed: false,
    });
  });
});
