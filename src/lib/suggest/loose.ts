/*
 * Forgiving text search, shared by the server (plain-text anchoring for the connector) and the
 * editor (re-finding a suggestion whose anchor came loose).
 *
 * "Loose" text treats curly and straight quotes, dashes and odd spaces alike, collapses runs of
 * spaces to one, and collapses any run of whitespace containing a line break to one line break
 * (so a blank line matches a paragraph break). "Looser" text goes one step further and treats a
 * line break like a space (so text still matches after two paragraphs are joined). Every
 * character remembers where it came from, so a match maps back to exact offsets in the original.
 */

export interface Loose {
  text: string;
  /** Original index where loose character i starts. */
  start: number[];
  /** Original index just after loose character i ends. */
  end: number[];
}

function fold(ch: string): string {
  if (ch === "‘" || ch === "’" || ch === "ʼ") return "'";
  if (ch === "“" || ch === "”") return '"';
  if (ch === "–" || ch === "—") return "-";
  return ch;
}

const SPACE = /[ \t   \r\n]/;

export function loosen(s: string, breaksAreSpaces = false): Loose {
  const out: string[] = [];
  const start: number[] = [];
  const end: number[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (SPACE.test(ch)) {
      let j = i;
      let breaks = false;
      while (j < s.length && SPACE.test(s[j])) {
        if (s[j] === "\n") breaks = true;
        j++;
      }
      out.push(breaks && !breaksAreSpaces ? "\n" : " ");
      start.push(i);
      end.push(j);
      i = j;
    } else {
      out.push(fold(ch));
      start.push(i);
      end.push(i + 1);
      i++;
    }
  }
  return { text: out.join(""), start, end };
}

export type Found = { start: number; end: number } | { error: "missing" | "ambiguous"; count: number };

function allIndexes(hay: string, needle: string): number[] {
  const at: number[] = [];
  if (!needle) return at;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) at.push(i);
  return at;
}

export interface Hay {
  text: string;
  loose?: Loose;
  looser?: Loose;
}

/**
 * Where `needle` occurs in `hay`: exactly first, then loosely, then with line breaks treated as
 * spaces. When it occurs more than once, `near` (an offset in `hay`) picks the closest
 * occurrence; without it that is ambiguous.
 */
export function findText(hay: string | Hay, needle: string, near?: number): Found {
  const h: Hay = typeof hay === "string" ? { text: hay } : hay;
  if (!needle) return { error: "missing", count: 0 };
  const pick = (starts: number[], len: number, toStart: (i: number) => number, toEnd: (i: number) => number): Found | null => {
    if (!starts.length) return null;
    if (starts.length > 1 && near === undefined) return { error: "ambiguous", count: starts.length };
    const best = near === undefined ? starts[0] : starts.reduce((a, b) => (Math.abs(toStart(b) - near) < Math.abs(toStart(a) - near) ? b : a));
    return { start: toStart(best), end: toEnd(best + len - 1) };
  };
  const exact = pick(allIndexes(h.text, needle), needle.length, (i) => i, (i) => i + 1);
  if (exact) return exact;
  for (const breaksAreSpaces of [false, true]) {
    const l = breaksAreSpaces ? (h.looser ??= loosen(h.text, true)) : (h.loose ??= loosen(h.text));
    const n = loosen(needle, breaksAreSpaces).text.trim();
    const found = pick(allIndexes(l.text, n), n.length, (i) => l.start[i], (i) => l.end[i]);
    if (found && "error" in found) return found;
    if (found) return found;
  }
  return { error: "missing", count: 0 };
}
