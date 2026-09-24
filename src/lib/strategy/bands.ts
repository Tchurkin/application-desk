/*
 * The Strategy page's standard admission-odds bands. Pure: the page, the connector and tests
 * share it.
 *
 * A college's chance is the number the connected AI or the student set; without one, the
 * college's published average admission rate stands in (clearly labeled: it ignores the
 * student's profile). Colleges outside the US skip the bands: they tend to admit on stated
 * grades or a ranked selection, so they are described instead of given a percentage.
 */

/** Under this is a Reach. */
export const REACH_BELOW = 20;
/** Over this is Likely; REACH_BELOW..LIKELY_ABOVE (both inclusive) is Target. */
export const LIKELY_ABOVE = 60;

export type Band = "reach" | "target" | "likely" | "unrated";
export type ChanceSource = "ai" | "student" | "average";

export const BANDS: { id: Band; title: string; blurb: string }[] = [
  {
    id: "reach",
    title: "Reach",
    blurb: `Under ${REACH_BELOW}%. Each one is a long shot even for a strong applicant, which is fine when the rest of the list is solid.`,
  },
  {
    id: "target",
    title: "Target",
    blurb: `${REACH_BELOW} to ${LIKELY_ABOVE}%. This band usually decides how the year turns out, so the writing here earns the most.`,
  },
  {
    id: "likely",
    title: "Likely",
    blurb: `Over ${LIKELY_ABOVE}%. Make sure at least one of these is a place you would be happy to attend.`,
  },
  {
    id: "unrated",
    title: "Unrated",
    blurb: "No chance set, and no published admission rate found for the name. Set one yourself or ask your assistant to estimate it.",
  },
];

export const SOURCE_LABEL: Record<ChanceSource, string> = {
  ai: "AI estimate",
  student: "Your estimate",
  average: "Average rate",
};

/** What the catalog knows about a college (the College Scorecard baseline). */
export interface Baseline {
  /** Published admission rate, 0..1. */
  rate: number;
  sat?: number;
  act?: number;
  /** Average yearly cost of attendance, USD. */
  cost?: number;
  /** Average yearly net price after aid, USD. */
  net?: number;
}

/** The strategy fields of a college row. All optional: an older database has none of them. */
export interface StrategyCollege {
  id: string;
  name: string;
  country?: string | null;
  chance_percent?: number | string | null;
  chance_source?: "ai" | "student" | null;
  chance_note?: string | null;
  fit_rank?: number | null;
  campus_life?: number | null;
  reputation?: number | null;
  cost_sticker?: number | null;
  cost_net?: number | null;
  intl_course?: string | null;
  intl_criterion?: string | null;
  intl_cost?: string | null;
  intl_status?: string | null;
}

export interface Chance {
  value: number;
  source: ChanceSource;
}

export interface Cost {
  amount: number;
  kind: "net" | "sticker";
  /** The catalog's average for the college, not the student's own figure. */
  average: boolean;
}

export interface StrategyRow<C extends StrategyCollege = StrategyCollege> {
  college: C;
  chance: Chance | null;
  band: Band;
  cost: Cost | null;
}

export interface Strategy<C extends StrategyCollege = StrategyCollege> {
  /** Reach, Target, Likely and Unrated, in that order, each possibly empty. */
  bands: { id: Band; title: string; blurb: string; rows: StrategyRow<C>[] }[];
  /** Colleges outside the US, in the order given. */
  international: C[];
}

const US_NAMES = /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i;

/** Outside the US. Blank or missing means the US (the column's default). */
export function isInternational(country: string | null | undefined): boolean {
  const c = country?.trim() ?? "";
  return c !== "" && !US_NAMES.test(c);
}

/** A number from a numeric column, which can arrive as a string; null when unreadable. */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function bandOf(chance: number | null | undefined): Band {
  if (chance === null || chance === undefined || !Number.isFinite(chance)) return "unrated";
  if (chance < REACH_BELOW) return "reach";
  if (chance <= LIKELY_ABOVE) return "target";
  return "likely";
}

/** The chance shown for a college: its own estimate, else the published average rate. */
export function chanceOf(c: StrategyCollege, baseline: Baseline | null): Chance | null {
  const own = num(c.chance_percent);
  if (own !== null) return { value: own, source: c.chance_source === "ai" ? "ai" : "student" };
  if (baseline && Number.isFinite(baseline.rate)) {
    // One decimal, and the band is taken from the same rounded number the page shows.
    return { value: Math.round(baseline.rate * 1000) / 10, source: "average" };
  }
  return null;
}

/** Yearly cost: the student's net after aid, else their sticker price, else the catalog's averages. */
export function costOf(c: StrategyCollege, baseline: Baseline | null): Cost | null {
  const net = num(c.cost_net);
  if (net !== null) return { amount: net, kind: "net", average: false };
  const sticker = num(c.cost_sticker);
  if (sticker !== null) return { amount: sticker, kind: "sticker", average: false };
  if (baseline?.net !== undefined) return { amount: baseline.net, kind: "net", average: true };
  if (baseline?.cost !== undefined) return { amount: baseline.cost, kind: "sticker", average: true };
  return null;
}

/** Best fit first (unranked last), then the higher chance, then by name. */
/** Lowest chance first (the long shots lead), then best fit, then name. */
function compareRows(a: StrategyRow, b: StrategyRow): number {
  const ca = a.chance?.value ?? Infinity;
  const cb = b.chance?.value ?? Infinity;
  if (ca !== cb) return ca - cb;
  const fa = num(a.college.fit_rank) ?? Infinity;
  const fb = num(b.college.fit_rank) ?? Infinity;
  if (fa !== fb) return fa - fb;
  return a.college.name.localeCompare(b.college.name);
}

/** Every college in its band (or the international list). `baselineOf` looks up the catalog. */
export function buildStrategy<C extends StrategyCollege>(
  colleges: C[],
  baselineOf: (c: C) => Baseline | null,
): Strategy<C> {
  const international: C[] = [];
  const rows: StrategyRow<C>[] = [];
  for (const college of colleges) {
    if (isInternational(college.country)) {
      international.push(college);
      continue;
    }
    const baseline = baselineOf(college);
    const chance = chanceOf(college, baseline);
    rows.push({ college, chance, band: bandOf(chance?.value), cost: costOf(college, baseline) });
  }
  rows.sort(compareRows);
  return {
    bands: BANDS.map((b) => ({ ...b, rows: rows.filter((r) => r.band === b.id) })),
    international,
  };
}

/** "35%", "49.9%", "<1%". One decimal is kept so a 19.6% never reads as a 20% sitting in Reach. */
export function formatPercent(p: number): string {
  if (p > 0 && p < 1) return "<1%";
  return `${Math.round(p * 10) / 10}%`;
}

/** "$14.6k" for a yearly cost; small amounts in full. */
export function formatMoney(n: number): string {
  if (n < 1000) return `$${Math.round(n)}`;
  return `$${Math.round(n / 100) / 10}k`;
}

/** Width of the chance bar, in percent: never under 3 so a small chance still shows. */
export function barWidth(chance: number): number {
  return Math.min(100, Math.max(3, chance));
}

/** A reminder when the list is lopsided, or null when it looks balanced. */
export function balanceNote(strategy: Strategy): string | null {
  const count = (id: Band) => strategy.bands.find((b) => b.id === id)?.rows.length ?? 0;
  const rated = count("reach") + count("target") + count("likely");
  if (rated === 0) return null;
  if (count("reach") === rated) return "Every rated college is a Reach. Add a Target or two and at least one Likely you'd be glad to attend.";
  if (count("likely") === 0) return "No Likely college yet. Most lists need at least one you'd be happy to attend and are very likely to get into.";
  return null;
}
