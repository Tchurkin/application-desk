/** Words as an admissions portal counts them: runs of non-space characters. */
export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Characters, counting each user-visible character (emoji, accents) once. */
export function countChars(text: string): number {
  return Array.from(text).length;
}

export type LimitKind = "words" | "chars" | "none";

export interface LimitState {
  used: number;
  limit: number | null;
  over: boolean;
  /** 0..1, capped at 1; null when there is no limit. */
  fraction: number | null;
}

export function limitState(text: string, kind: LimitKind, limit: number | null): LimitState {
  const used = kind === "chars" ? countChars(text) : countWords(text);
  if (kind === "none" || !limit || limit <= 0) {
    return { used, limit: null, over: false, fraction: null };
  }
  return { used, limit, over: used > limit, fraction: Math.min(1, used / limit) };
}
