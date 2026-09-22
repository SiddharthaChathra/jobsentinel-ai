import { SKILL_DICTIONARY, type SkillDef } from '@jobsentinel/config';

export interface ExtractedSkill {
  name: string;
  category: SkillDef['category'];
  /** The alias or name that matched, for explainability. */
  matchedOn: string;
}

interface CompiledSkill {
  def: SkillDef;
  patterns: { term: string; regex: RegExp }[];
}

let compiled: CompiledSkill[] | null = null;

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive; boundaries tolerate symbols so "C++", "C#", ".NET" work. */
function compile(): CompiledSkill[] {
  if (compiled) return compiled;
  compiled = SKILL_DICTIONARY.map((def) => ({
    def,
    patterns: [def.name, ...(def.aliases ?? [])].map((term) => ({
      term,
      regex: new RegExp(`(?<![a-z0-9+#])${escape(term.toLowerCase())}(?![a-z0-9+#])`, 'i'),
    })),
  }));
  return compiled;
}

/**
 * Deterministic skill extraction against the dictionary. Used as the AI fallback for resumes
 * and as the base signal for job requirements (docs 09 §3). Short single-letter names ("C", "R")
 * are only matched when they appear in a list context to avoid false positives.
 */
export function extractSkills(text: string): ExtractedSkill[] {
  const hay = text.replace(/\s+/g, ' ');
  const out: ExtractedSkill[] = [];
  for (const { def, patterns } of compile()) {
    for (const { term, regex } of patterns) {
      if (term.length === 1) {
        // e.g. "C, C++, Java" or "Languages: C"
        const listCtx = new RegExp(
          `(?:[:,(/]\\s*|^|\\s)${escape(term)}(?=\\s*(?:,|/|\\)|$|\\band\\b))`,
          'i',
        );
        if (!listCtx.test(hay)) continue;
      } else if (!regex.test(hay)) {
        continue;
      }
      out.push({ name: def.name, category: def.category, matchedOn: term });
      break;
    }
  }
  return out;
}

/** Best guess of the (expected) graduation year from phrases like "expected 2027", "Batch of 2026", "2023 – 2027". */
export function extractGraduationYear(text: string, now = new Date()): number | null {
  const y = now.getFullYear();
  const candidates: number[] = [];
  const explicit =
    text.match(
      /(?:expected|graduat\w*|batch(?: of)?|passing(?: out)?(?: year)?|class of)\D{0,20}(20\d{2})/gi,
    ) ?? [];
  for (const m of explicit) {
    const year = Number(m.match(/20\d{2}/)?.[0]);
    if (year >= y - 6 && year <= y + 6) candidates.push(year);
  }
  if (candidates.length === 0) {
    // Ranges like "2023 - 2027" / "2023–27": take the end year of the latest range.
    for (const m of text.matchAll(/(20\d{2})\s*[-–—to]+\s*(20\d{2}|\d{2})\b/g)) {
      const end = m[2]!.length === 2 ? Number(`20${m[2]}`) : Number(m[2]);
      if (end >= y - 6 && end <= y + 6) candidates.push(end);
    }
  }
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}
