/*
 * A word-level diff for comparing two versions of a piece side by side.
 *
 * Texts are split into words with the whitespace that follows each one kept, so the marked-up
 * result reads exactly like the original. Only the words are compared: a changed line break or
 * a double space is not a difference a writer cares about.
 */

export type DiffKind = "same" | "removed" | "added";

export interface DiffSegment {
  text: string;
  kind: DiffKind;
}

export interface WordDiff {
  /** The older text, with the words it loses marked "removed". */
  left: DiffSegment[];
  /** The newer text, with the words it gains marked "added". */
  right: DiffSegment[];
  removed: number;
  added: number;
}

interface Token {
  word: string;
  /** Whitespace after the word (or, for the first token of a text that starts with spaces, before it). */
  space: string;
}

/** Words with their trailing whitespace. Leading whitespace becomes a token with no word. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const lead = /^\s+/.exec(text);
  if (lead) tokens.push({ word: "", space: lead[0] });
  const re = /(\S+)(\s*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) tokens.push({ word: m[1], space: m[2] });
  return tokens;
}

/**
 * Above this many word pairs, only the shared start and end are matched. At the cap the table
 * takes 8 MB, and no common subsequence can be longer than 2,000 words, so 16 bits hold it.
 */
const MAX_CELLS = 4_000_000;

/**
 * Which words of `a` and `b` belong to their longest common subsequence. Shared prefixes and
 * suffixes are matched first, so versions that differ in a few places cost almost nothing.
 */
function commonWords(a: string[], b: string[]): { inA: Uint8Array; inB: Uint8Array } {
  const inA = new Uint8Array(a.length);
  const inB = new Uint8Array(b.length);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    inA[start] = inB[start] = 1;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    inA[--endA] = 1;
    inB[--endB] = 1;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0 || n * m > MAX_CELLS) return { inA, inB };

  // Classic LCS table over the middle, lengths from the end so the walk goes forwards.
  const width = m + 1;
  const table = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      inA[start + i] = inB[start + j] = 1;
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
    else j++;
  }
  return { inA, inB };
}

/**
 * Marked-up segments for one side. A space between two changed words is part of the change,
 * so a changed phrase reads as one highlight; a space next to an unchanged word is not.
 */
function segments(tokens: Token[], kept: Uint8Array, changed: DiffKind): DiffSegment[] {
  const out: DiffSegment[] = [];
  const push = (text: string, kind: DiffKind) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  tokens.forEach((t, i) => {
    const isChanged = !kept[i] && t.word !== "";
    push(t.word, isChanged ? changed : "same");
    const next = tokens[i + 1];
    const nextChanged = !!next && !kept[i + 1] && next.word !== "";
    push(t.space, isChanged && nextChanged ? changed : "same");
  });
  return out;
}

/** Compare two texts word by word. */
export function wordDiff(older: string, newer: string): WordDiff {
  const ta = tokenize(older);
  const tb = tokenize(newer);
  const { inA, inB } = commonWords(
    ta.map((t) => t.word),
    tb.map((t) => t.word),
  );
  // Leading-whitespace tokens have no word; they are always "the same".
  ta.forEach((t, i) => t.word === "" && (inA[i] = 1));
  tb.forEach((t, i) => t.word === "" && (inB[i] = 1));
  let removed = 0;
  let added = 0;
  inA.forEach((k) => k || removed++);
  inB.forEach((k) => k || added++);
  return { left: segments(ta, inA, "removed"), right: segments(tb, inB, "added"), removed, added };
}
