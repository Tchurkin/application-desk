import "server-only";
import data from "@/data/admission-rates.json";
import { buildIndex, candidates, lookup, type CatalogEntry } from "./match";

/*
 * The bundled College Scorecard catalog (U.S. Department of Education, public domain): every
 * U.S. college with a published admission rate, plus average SAT/ACT and yearly cost. It is the
 * baseline for the Strategy page and money figures when no AI (or student) has set better ones.
 * Rebuild with scripts/build_admission_rates.py. Server-only so the data stays out of the browser.
 */

export type { CatalogEntry } from "./match";
export { normalizeName } from "./match";

const index = buildIndex((data as { schools: CatalogEntry[] }).schools);

/**
 * The catalog entry for a college the student typed, or null. An exact (normalized) name or alias
 * match wins; when several colleges share it, none is guessed at (see catalogCandidates).
 */
export function matchCollege(name: string, scorecardId?: number | null): CatalogEntry | null {
  return lookup(index, name, scorecardId);
}

export function catalogById(id: number): CatalogEntry | null {
  return index.byId.get(id) ?? null;
}

/** The catalog colleges that share this name, when matchCollege can't pick one. */
export function catalogCandidates(name: string): CatalogEntry[] {
  return candidates(index, name);
}
