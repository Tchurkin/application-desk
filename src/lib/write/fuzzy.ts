/*
 * Fuzzy matching for the quick switcher: every letter of the query must appear in order.
 * Matches at the start of words and runs of consecutive letters score higher, so "wn" finds
 * "Why Northfield?" before "Winter".
 */

/** A score for `query` against `text` (higher is better), or null when it doesn't match. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  // A plain substring beats any scattered match.
  const at = t.indexOf(query.toLowerCase().trim());
  if (at >= 0) return 1000 - at + (at === 0 || /\W/.test(t[at - 1]) ? 100 : 0);
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const wordStart = found === 0 || /[\s\-_·/(]/.test(t[found - 1]);
    run = found === ti && ti > 0 ? run + 1 : 0;
    score += 1 + (wordStart ? 8 : 0) + run * 4 - Math.min(found - ti, 10) * 0.5;
    ti = found + 1;
  }
  return score;
}

/** The items that match, best first; ties keep their original order. */
export function rank<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, score: fuzzyScore(query, textOf(item)) }))
    .filter((x): x is { item: T; i: number; score: number } => x.score !== null)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.item);
}
