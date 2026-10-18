import { PLACEHOLDER_TITLE_PATTERNS } from '@jobsentinel/config';

/**
 * Whether a posting is a placeholder, not a job (D117): "Don't see what you're looking for?",
 * "General Application", "Join our talent network". Deterministic, title only, never the AI.
 * Returns the matched phrase (for the event log), or null for a real posting.
 */
export function placeholderMatch(title: string): string | null {
  for (const pattern of PLACEHOLDER_TITLE_PATTERNS) {
    const m = pattern.exec(title);
    if (m) return m[0];
  }
  return null;
}
