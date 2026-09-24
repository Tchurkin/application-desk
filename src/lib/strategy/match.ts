/*
 * Matching a college name the student typed to the College Scorecard catalog. Pure, so it can be
 * tested against a small list; catalog.ts builds the real index from the bundled data.
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

export interface CatalogIndex {
  byId: Map<number, CatalogEntry>;
  /** A college's own name or one of its aliases. */
  exact: Map<string, CatalogEntry[]>;
  /** The part of a name before "-", so "University of Michigan-Dearborn" is also "University of Michigan". */
  base: Map<string, CatalogEntry[]>;
}

function add(map: Map<string, CatalogEntry[]>, key: string, s: CatalogEntry) {
  const k = normalizeName(key);
  if (!k) return;
  const list = map.get(k) ?? [];
  if (!list.includes(s)) list.push(s);
  map.set(k, list);
}

export function buildIndex(schools: CatalogEntry[]): CatalogIndex {
  const ix: CatalogIndex = { byId: new Map(schools.map((s) => [s.id, s])), exact: new Map(), base: new Map() };
  for (const s of schools) {
    add(ix.exact, s.name, s);
    for (const a of s.alias?.split(/[|,]/) ?? []) add(ix.exact, a.trim(), s);
    const base = s.name.split("-")[0];
    if (base !== s.name) add(ix.base, base, s);
  }
  return ix;
}

/**
 * The catalog entry for a college the student typed, or null. A college's own name or alias wins
 * over a shared campus prefix: "University of Michigan" is Ann Arbor (its alias), not Dearborn or
 * Flint, which only share the prefix. When several colleges share a name equally, none is guessed.
 */
export function lookup(ix: CatalogIndex, name: string, scorecardId?: number | null): CatalogEntry | null {
  if (scorecardId && ix.byId.has(scorecardId)) return ix.byId.get(scorecardId)!;
  const key = normalizeName(name);
  const exact = ix.exact.get(key) ?? [];
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const base = ix.base.get(key) ?? [];
  return base.length === 1 ? base[0] : null;
}

/** Every catalog college going by this name, for picking one when the name alone is ambiguous. */
export function candidates(ix: CatalogIndex, name: string): CatalogEntry[] {
  const key = normalizeName(name);
  const all = [...(ix.exact.get(key) ?? []), ...(ix.base.get(key) ?? [])];
  return [...new Set(all)].sort((a, b) => a.name.localeCompare(b.name));
}
