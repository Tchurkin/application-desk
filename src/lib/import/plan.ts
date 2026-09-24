import { countWords } from "@/lib/domain/count";
import type { Para, SourceDoc } from "./sources";

/*
 * From SourceDocs to what the student reviews before importing: each essay's title and text, the
 * college it belongs to and the piece already on the desk it fills in, guessed from the names
 * students actually use ("Stanford - Why us", a doc called "MIT essays" with a tab per prompt, a
 * folder per college). Pure, so it is tested without a database.
 */

export interface DeskCollege {
  id: string;
  name: string;
}

export interface DeskPiece {
  id: string;
  title: string;
  college_id: string | null;
  word_count: number;
}

export interface ImportRow {
  key: string;
  title: string;
  text: string;
  words: number;
  /** Where it came from, for the student to recognize it. */
  from: string;
  collegeId: string | null;
  /** An existing piece to fill in, or null for a new piece. */
  pieceId: string | null;
  include: boolean;
  /** How many parts splitting at headings would make (0 when it can't be split). */
  parts: number;
}

const STOP = new Set([
  "university", "college", "of", "the", "at", "in", "and", "institute", "technology", "school", "for", "a", "an",
  "campus", "main", "essay", "essays", "supplement", "supplements", "supplemental", "application", "draft", "final",
  "copy", "doc", "docs", "new", "v1", "v2", "v3",
]);

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const keyWords = (s: string) => words(s).filter((w) => w.length > 2 && !STOP.has(w));

const initials = (s: string) =>
  words(s)
    .filter((w) => !["of", "the", "and", "at", "in", "for"].includes(w))
    .map((w) => w[0])
    .join("");

/**
 * The abbreviations a college goes by: "Massachusetts Institute of Technology" → "mit",
 * "University of California-Los Angeles" → "ucla", and without the campus,
 * "University of North Carolina at Chapel Hill" → "unc".
 */
function acronyms(name: string): string[] {
  const campusless = name.split(/\s+at\s+|\s*[-–—,]\s*/i)[0];
  return [...new Set([initials(name), initials(campusless)])].filter((a) => a.length >= 3);
}

/** The college a doc belongs to, from its title and where it came from; null when unsure. */
export function guessCollege(texts: string[], colleges: DeskCollege[]): string | null {
  const tokens = new Set(texts.flatMap(words));
  const scored = colleges
    .map((c) => {
      const keys = keyWords(c.name);
      const found = keys.filter((k) => tokens.has(k)).length;
      // All its distinctive words ("Stanford") or an abbreviation ("MIT") settle it; half its
      // words ("Chapel Hill") is a good sign; its first word alone is a hint.
      if ((keys.length > 0 && found === keys.length) || acronyms(c.name).some((a) => tokens.has(a))) return { id: c.id, score: 3 };
      if (keys.length > 0 && found * 2 >= keys.length) return { id: c.id, score: 2 };
      return { id: c.id, score: keys.length > 0 && tokens.has(keys[0]) ? 1 : 0 };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0].id;
}

/** How alike two titles are, 0 to 1 (shared words over the smaller title's words). */
function likeness(a: string, b: string): number {
  const x = new Set(keyWords(a).concat(words(a).filter((w) => w === "why")));
  const y = new Set(keyWords(b).concat(words(b).filter((w) => w === "why")));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** The existing piece (for that college, or shared) a doc fills in; null for a new piece. */
export function guessPiece(title: string, collegeId: string | null, pieces: DeskPiece[], taken: Set<string> = new Set()): string | null {
  const exact = title.trim().toLowerCase();
  const candidates = pieces.filter((p) => p.college_id === collegeId && !taken.has(p.id));
  const same = candidates.find((p) => p.title.trim().toLowerCase() === exact);
  if (same) return same.id;
  const best = candidates.map((p) => ({ id: p.id, score: likeness(title, p.title) })).sort((a, b) => b.score - a.score)[0];
  return best && best.score >= 0.5 ? best.id : null;
}

/** The text of some paragraphs: blank lines at the ends dropped, runs of blank lines kept to one. */
export function paragraphsText(paragraphs: Para[]): string {
  return paragraphs
    .map((p) => p.text.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The heading level a doc can be split at: the highest level used at least twice (a single title
 * heading above the essays isn't a split point).
 */
function splitLevel(paragraphs: Para[]): number {
  const levels = paragraphs.filter((p) => p.heading > 0 && p.text.trim()).map((p) => p.heading);
  for (let level = 1; level <= 6; level++) {
    if (levels.filter((l) => l === level).length >= 2) return level;
  }
  return 0;
}

export function partsIn(doc: SourceDoc): number {
  const level = splitLevel(doc.paragraphs);
  return level ? doc.paragraphs.filter((p) => p.heading === level && p.text.trim()).length : 0;
}

/** A doc split at its top headings: one SourceDoc per heading, titled by it. */
export function splitAtHeadings(doc: SourceDoc): SourceDoc[] {
  const level = splitLevel(doc.paragraphs);
  if (!level) return [doc];
  const out: SourceDoc[] = [];
  let current: SourceDoc | null = null;
  const before: Para[] = [];
  for (const p of doc.paragraphs) {
    if (p.heading === level && p.text.trim()) {
      current = { key: `${doc.key}#${out.length}`, title: p.text.trim(), from: doc.from ? `${doc.from} › ${doc.title}` : doc.title, paragraphs: [] };
      out.push(current);
    } else if (current) current.paragraphs.push(p);
    else before.push(p);
  }
  // Text before the first heading (often the doc's own title or notes) stays with the first part.
  if (out.length && paragraphsText(before)) out[0].paragraphs.unshift(...before);
  return out;
}

/** Review rows for these docs, each matched to a college and an existing piece where it can be. */
export function planRows(docs: SourceDoc[], colleges: DeskCollege[], pieces: DeskPiece[], taken: Set<string> = new Set()): ImportRow[] {
  const used = new Set(taken);
  return docs.map((d) => {
    const text = paragraphsText(d.paragraphs);
    const collegeId = guessCollege([d.title, d.from], colleges);
    const pieceId = guessPiece(d.title, collegeId, pieces, used);
    if (pieceId) used.add(pieceId);
    return {
      key: d.key,
      title: d.title.slice(0, 300) || "Untitled",
      text,
      words: countWords(text),
      from: d.from,
      collegeId,
      pieceId,
      include: text.length > 0,
      parts: partsIn(d),
    };
  });
}
