import { z } from 'zod';
import raw from './learning-links.json';

/**
 * Curated learning resources per skill (F7, D120). The map is data in the repo, validated here
 * so a malformed edit fails at start-up (and in the unit test) rather than in a user's report.
 * Only `approved` entries are ever shown: links are proposed by Claude, approved by the owner.
 */
const LearningLink = z.object({
  title: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
  publisher: z.string().min(1),
});
export type LearningLink = z.infer<typeof LearningLink>;

const LearningLinksFile = z.object({
  version: z.literal(1),
  about: z.string(),
  skills: z.record(
    z.string(),
    z.object({ approved: z.boolean(), links: z.array(LearningLink).min(1).max(3) }),
  ),
});

export const LEARNING_LINKS = LearningLinksFile.parse(raw);

/** The approved links for a canonical skill name; empty when none is approved. */
export function approvedLearningLinks(skill: string): LearningLink[] {
  const entry = LEARNING_LINKS.skills[skill];
  return entry?.approved ? entry.links : [];
}
