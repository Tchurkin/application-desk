import type { CollegeRow } from "@/lib/data/queries";
import type { CatalogEntry } from "@/lib/strategy/catalog";

/*
 * Yearly cost per college for the Board's Money table and the college page. A figure the AI or
 * the student set wins; otherwise the College Scorecard average stands in, marked "avg" because
 * it is what students pay on average, not this student's price.
 */

export interface Figure {
  amount: number;
  /** From the catalog's average, not the student's own figure. */
  avg: boolean;
}

export interface MoneyRow {
  id: string;
  name: string;
  sticker: Figure | null;
  net: Figure | null;
  note: string;
}

type Costs = Pick<CollegeRow, "id" | "name" | "country" | "cost_sticker" | "cost_net" | "intl_cost">;

const US_NAMES = /^(us|usa|u\.s\.a?\.?|united states( of america)?)$/i;

/** A college outside the US: the catalog has no figures for it. Blank or missing means US. */
export function isAbroad(c: Pick<CollegeRow, "country">): boolean {
  const country = c.country?.trim() ?? "";
  return country !== "" && !US_NAMES.test(country);
}

function figure(own: number | null | undefined, avg: number | undefined): Figure | null {
  if (own !== null && own !== undefined) return { amount: Number(own), avg: false };
  if (avg !== undefined) return { amount: avg, avg: true };
  return null;
}

/** `entry` is the college's catalog match (matchCollege), or null. */
export function moneyRow(c: Costs, entry: CatalogEntry | null): MoneyRow {
  const abroad = isAbroad(c);
  const base = abroad ? null : entry;
  const sticker = figure(c.cost_sticker, base?.cost);
  const net = figure(c.cost_net, base?.net);
  let note = "";
  if (abroad) note = c.intl_cost?.trim() || "Outside the US: no average on file.";
  else if (!sticker && !net) note = entry ? "No cost on file." : "Not in the college catalog.";
  else if (base?.public && (sticker?.avg || net?.avg)) note = "Public college: in-state average.";
  return { id: c.id, name: c.name, sticker, net, note };
}

/** Cheapest net first (sticker when there is no net figure), colleges without figures last. */
export function sortByCost(rows: MoneyRow[]): MoneyRow[] {
  const cost = (r: MoneyRow) => r.net?.amount ?? r.sticker?.amount ?? Infinity;
  return [...rows].sort((a, b) => cost(a) - cost(b) || a.name.localeCompare(b.name));
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatUSD(amount: number): string {
  return usd.format(amount);
}
