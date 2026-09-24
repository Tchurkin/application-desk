import type { CollegeRow } from "@/lib/data/queries";
import type { CatalogEntry } from "@/lib/strategy/catalog";
import { isAbroad } from "./money";

/*
 * A college's admission odds for its summary on the college page. The connected AI's estimate
 * (or the student's own) wins; without one, the college's published acceptance rate stands in.
 * Levels use the Strategy page's standard cutoffs: Reach under 20%, Target 20 to 60%, Likely
 * over 60%. A college with no number is Unrated, never silently a Reach.
 */

export const REACH_BELOW = 20;
export const LIKELY_ABOVE = 60;

export type OddsLevel = "reach" | "target" | "likely" | "unrated";
export type ChanceSource = "ai" | "student" | "avg";

export const LEVEL_LABEL: Record<OddsLevel, string> = {
  reach: "Reach",
  target: "Target",
  likely: "Likely",
  unrated: "Unrated",
};

export const SOURCE_LABEL: Record<ChanceSource, string> = {
  ai: "AI estimate",
  student: "Your estimate",
  avg: "Average acceptance rate, not your chance",
};

export interface Chance {
  percent: number | null;
  source: ChanceSource | null;
  level: OddsLevel;
}

export function levelOf(percent: number | null): OddsLevel {
  if (percent === null || !Number.isFinite(percent)) return "unrated";
  if (percent < REACH_BELOW) return "reach";
  if (percent <= LIKELY_ABOVE) return "target";
  return "likely";
}

type Odds = Pick<CollegeRow, "chance_percent" | "chance_source" | "country">;

export function chanceOf(c: Odds, entry: CatalogEntry | null): Chance {
  // Postgres numeric can arrive as a string; treat anything unreadable as missing.
  const own = c.chance_percent === null || c.chance_percent === undefined ? NaN : Number(c.chance_percent);
  if (Number.isFinite(own)) {
    return { percent: own, source: c.chance_source === "ai" ? "ai" : "student", level: levelOf(own) };
  }
  if (entry && !isAbroad(c)) {
    const avg = Math.round(entry.rate * 1000) / 10;
    return { percent: avg, source: "avg", level: levelOf(avg) };
  }
  return { percent: null, source: null, level: "unrated" };
}

/** "35%", "4.5%", "<1%". */
export function formatPercent(p: number): string {
  if (p > 0 && p < 1) return "<1%";
  return `${p < 10 ? Math.round(p * 10) / 10 : Math.round(p)}%`;
}
