/*
 * Version thinning.
 *
 * A piece keeps every version from the last hour, then about one an hour back to a day,
 * one a day back to a week, and one a week before that. The first version ever saved and
 * the newest are always kept. If the result is still over the count or size cap, the
 * spacing is coarsened (every step doubled) rather than dropping the oldest versions, so a
 * year-old piece always keeps its beginning.
 *
 * Buckets are measured by age from `now`, and the newest version in each bucket survives.
 */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

/** Most versions a piece keeps. */
export const HIST_KEEP = 250;
/** Most characters of text, summed across a piece's versions. */
export const HIST_BYTES = 4_000_000;

/** Up to `maxAge`, keep one version per `step` of age (0 = keep all). */
export const HIST_STEPS: ReadonlyArray<{ maxAge: number; step: number }> = [
  { maxAge: HOUR, step: 0 },
  { maxAge: DAY, step: HOUR },
  { maxAge: WEEK, step: DAY },
  { maxAge: Infinity, step: WEEK },
];

export interface VersionLike {
  /** Milliseconds since the epoch. */
  at: number;
  /** Characters this version costs against HIST_BYTES. */
  size: number;
}

/** One thinning pass at a given coarseness. `list` must be sorted oldest first. */
export function thinOnce<T extends VersionLike>(list: T[], now: number, scale: number): T[] {
  if (list.length <= 2) return list.slice();
  const first = list[0];
  const newest = list[list.length - 1];
  const keep = new Set<T>([first, newest]);
  const seen = new Set<string>();

  // Walk newest to oldest so the first version seen in a bucket is its newest.
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i];
    const age = Math.max(0, now - v.at);
    const band = HIST_STEPS.findIndex((s) => age < s.maxAge);
    const base = HIST_STEPS[band].step;
    // At scale 1 the last hour keeps everything; coarser scales thin it too.
    const step = base === 0 ? (scale > 1 ? (scale / 2) * 5 * MINUTE : 0) : base * scale;
    const key = step === 0 ? `${band}:${i}` : `${band}:${Math.floor(age / step)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(v);
  }
  return list.filter((v) => keep.has(v));
}

function fits<T extends VersionLike>(list: T[]): boolean {
  return list.length <= HIST_KEEP && list.reduce((a, v) => a + v.size, 0) <= HIST_BYTES;
}

/** The versions to keep. Input in any order; output sorted oldest first. */
export function trimHistory<T extends VersionLike>(input: T[], now: number): T[] {
  const list = input.slice().sort((a, b) => a.at - b.at);
  if (list.length <= 2) return list;
  for (let scale = 1; scale <= 1 << 12; scale *= 2) {
    const kept = thinOnce(list, now, scale);
    if (fits(kept)) return kept;
  }
  return [list[0], list[list.length - 1]];
}
