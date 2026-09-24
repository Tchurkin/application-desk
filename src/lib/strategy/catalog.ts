import "server-only";
import data from "@/data/admission-rates.json";

/*
 * The bundled College Scorecard catalog (U.S. Department of Education, public domain): every
 * U.S. college with a published admission rate, plus average SAT/ACT and yearly cost. It is the
 * baseline for the Strategy page and money figures when no AI (or student) has set better ones.
 * Rebuild with scripts/build_admission_rates.py.
 */

export interface CatalogEntry {
  id: number;
  name: string;
  alias?: string;
  city: string;
  state: string;
  /** Overall admission rate, 0..1. */
  rate: number;
  sat?: number;
  act?: number;
  /** Average yearly cost of attendance (in-state for public colleges), USD. */
  cost?: number;
  /** Average yearly net price after grants and aid, USD. */
  net?: number;
  public?: boolean;
}

const schools = (data as { schools: CatalogEntry[] }).schools;
const byId = new Map(schools.map((s) => [s.id, s]));

/** Lowercase, no punctuation, no filler words, so "U of Michigan" ~ "University of Michigan". */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/-main campus$/, "")
    .replace(/\b(univ|u)\b/g, "university")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(the|of|at|in)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const index = new Map<string, CatalogEntry[]>();
function add(key: string, s: CatalogEntry) {
  const k = normalizeName(key);
  if (!k) return;
  const list = index.get(k) ?? [];
  if (!list.includes(s)) list.push(s);
  index.set(k, list);
}
for (const s of schools) {
  add(s.name, s);
  // "University of Michigan-Ann Arbor" is also known as "University of Michigan".
  const base = s.name.split("-")[0];
  if (base !== s.name) add(base, s);
  for (const a of s.alias?.split(/[|,]/) ?? []) add(a.trim(), s);
}

/**
 * The catalog entry for a college the student typed, or null. An exact (normalized) name or alias
 * match wins; when several colleges share it, the larger-named main campus is not guessed at.
 */
export function matchCollege(name: string, scorecardId?: number | null): CatalogEntry | null {
  if (scorecardId && byId.has(scorecardId)) return byId.get(scorecardId)!;
  const hits = index.get(normalizeName(name));
  if (hits?.length === 1) return hits[0];
  return null;
}

export function catalogById(id: number): CatalogEntry | null {
  return byId.get(id) ?? null;
}
