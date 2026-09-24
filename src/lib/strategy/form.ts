import { isInternational } from "./bands";

/*
 * Reading the Strategy page's edit form into a patch for a college row. Pure, so the rules are
 * tested: only fields present in the form are touched, a changed chance becomes the student's
 * own, and a cleared chance falls back to the published average rate.
 */

export interface StrategyPatch {
  chance_percent?: number | null;
  chance_source?: "student" | null;
  chance_note?: string;
  fit_rank?: number | null;
  campus_life?: number | null;
  reputation?: number | null;
  cost_sticker?: number | null;
  cost_net?: number | null;
  country?: string;
  intl_course?: string;
  intl_criterion?: string;
  intl_cost?: string;
  intl_status?: string;
  scorecard_id?: number | null;
}

type Form = Pick<FormData, "has" | "get">;
type Result = { patch: StrategyPatch } | { error: string };

class Invalid extends Error {}

const str = (f: Form, k: string) => String(f.get(k) ?? "").trim();

function number(f: Form, k: string, label: string, o: { min: number; max?: number; int?: boolean }): number | null {
  const raw = str(f, k).replace(/[$,%\s]/g, "");
  if (!raw) return null;
  const n = Number(raw);
  const bad =
    !Number.isFinite(n) || n < o.min || (o.max !== undefined && n > o.max) || (o.int && !Number.isInteger(n));
  if (bad) {
    const range = o.max !== undefined ? `between ${o.min} and ${o.max}` : `${o.min} or more`;
    throw new Invalid(`${label} must be ${o.int ? "a whole number " : ""}${range}.`);
  }
  return n;
}

/** Same number, allowing for a numeric column that arrives as a string. */
function same(a: number | null, b: number | string | null | undefined): boolean {
  const nb = b === null || b === undefined || b === "" ? null : Number(b);
  return a === nb;
}

export function parseStrategyForm(f: Form, current: { chance_percent?: number | string | null }): Result {
  const patch: StrategyPatch = {};
  try {
    let cleared = false;
    if (f.has("chance_percent")) {
      const chance = number(f, "chance_percent", "Chance", { min: 0, max: 100 });
      if (chance === null) {
        // Back to the published average rate; the old reasoning explained a number that's gone.
        cleared = current.chance_percent !== null && current.chance_percent !== undefined;
        if (cleared) Object.assign(patch, { chance_percent: null, chance_source: null, chance_note: "" });
      } else if (!same(chance, current.chance_percent)) {
        patch.chance_percent = Math.round(chance * 100) / 100;
        patch.chance_source = "student";
      }
    }
    if (f.has("chance_note") && !cleared) patch.chance_note = str(f, "chance_note").slice(0, 2000);
    if (f.has("fit_rank")) patch.fit_rank = number(f, "fit_rank", "Fit rank", { min: 1, int: true });
    if (f.has("campus_life")) patch.campus_life = number(f, "campus_life", "Campus life", { min: 0, max: 10, int: true });
    if (f.has("reputation")) patch.reputation = number(f, "reputation", "Reputation", { min: 0, max: 10, int: true });
    if (f.has("cost_sticker")) patch.cost_sticker = number(f, "cost_sticker", "Sticker cost", { min: 0, int: true });
    if (f.has("cost_net")) patch.cost_net = number(f, "cost_net", "Net cost", { min: 0, int: true });
    if (f.has("country")) {
      const country = str(f, "country").slice(0, 60);
      patch.country = isInternational(country) ? country : "US";
    }
    for (const k of ["intl_course", "intl_criterion", "intl_cost", "intl_status"] as const) {
      if (f.has(k)) patch[k] = str(f, k).slice(0, 500);
    }
    if (f.has("scorecard_id")) patch.scorecard_id = number(f, "scorecard_id", "Campus", { min: 1, int: true });
  } catch (e) {
    if (e instanceof Invalid) return { error: e.message };
    throw e;
  }
  return { patch };
}
