/*
 * Recommenders and the letters they write, as the board shows them: beside each college, one
 * chip per letter in its recommender's color (migration 20261005).
 */

export type LetterStatus = "planned" | "requested" | "submitted";

export const LETTER_STATUSES: { id: LetterStatus; label: string; short: string }[] = [
  { id: "planned", label: "Not asked yet", short: "to ask" },
  { id: "requested", label: "Asked", short: "asked" },
  { id: "submitted", label: "Submitted", short: "sent" },
];

export interface Recommender {
  id: string;
  name: string;
  role: string;
  /** 0 to 7: one of the board's eight recommender colors. */
  color: number;
  created_at?: string;
}

export interface Letter {
  college_id: string;
  recommender_id: string;
  status: LetterStatus;
}

export const REC_COLORS = 8;

export const asLetterStatus = (v: unknown): LetterStatus =>
  v === "requested" || v === "submitted" ? v : "planned";

export const letterStatusLabel = (s: LetterStatus) => LETTER_STATUSES.find((x) => x.id === s)?.label ?? s;

/** A color index the page can use, whatever the database holds. */
export const colorOf = (r: Pick<Recommender, "color">) =>
  Number.isInteger(r.color) ? ((r.color % REC_COLORS) + REC_COLORS) % REC_COLORS : 0;

/** Recommenders in the order they were added (the order their colors were handed out). */
export function sortRecommenders(list: Recommender[]): Recommender[] {
  return [...list].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.name.localeCompare(b.name));
}

/** A college's letters with their recommenders, in recommender order; letters whose recommender is gone are left out. */
export function lettersFor(
  collegeId: string,
  letters: Letter[],
  recommenders: Recommender[],
): { letter: Letter; recommender: Recommender }[] {
  const order = sortRecommenders(recommenders);
  return order.flatMap((recommender) => {
    const letter = letters.find((l) => l.college_id === collegeId && l.recommender_id === recommender.id);
    return letter ? [{ letter, recommender }] : [];
  });
}

/** "3 letters, 1 sent" for a recommender. */
export function letterCount(recommenderId: string, letters: Letter[]): string {
  const mine = letters.filter((l) => l.recommender_id === recommenderId);
  if (!mine.length) return "no letters yet";
  const sent = mine.filter((l) => l.status === "submitted").length;
  return `${mine.length} letter${mine.length === 1 ? "" : "s"}${sent ? `, ${sent} sent` : ""}`;
}

/** The color a new recommender gets: the one the desk uses least, the first on a tie (as the database picks). */
export function nextColor(recommenders: Recommender[]): number {
  const used = new Array<number>(REC_COLORS).fill(0);
  for (const r of recommenders) used[colorOf(r)]++;
  return used.indexOf(Math.min(...used));
}

/** The letters after one is set (a status) or taken off (null). */
export function withLetter(letters: Letter[], recommenderId: string, collegeId: string, status: LetterStatus | null): Letter[] {
  const rest = letters.filter((l) => !(l.recommender_id === recommenderId && l.college_id === collegeId));
  return status ? [...rest, { recommender_id: recommenderId, college_id: collegeId, status }] : rest;
}
