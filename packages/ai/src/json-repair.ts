/**
 * Best-effort cleanup of model output before JSON.parse.
 * Handles: markdown code fences, leading prose before the first `{`/`[`, trailing prose after the
 * last `}`/`]`, and trailing commas. Returns null when nothing parseable is found.
 */
export function extractJson(text: string): string | null {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const start = Math.min(...['{', '['].map((c) => s.indexOf(c)).filter((i) => i >= 0));
  if (!Number.isFinite(start)) return null;
  const endObj = s.lastIndexOf('}');
  const endArr = s.lastIndexOf(']');
  const end = Math.max(endObj, endArr);
  if (end < start) return null;
  s = s.slice(start, end + 1);
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s;
}

export function parseJsonLoose(text: string): unknown {
  const candidate = extractJson(text);
  if (candidate === null) return undefined;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}
