import Link from "next/link";
import type { CollegeRow } from "@/lib/data/queries";
import type { CatalogEntry } from "@/lib/strategy/catalog";
import { chanceOf, formatPercent, LEVEL_LABEL, SOURCE_LABEL, type OddsLevel } from "./chance";
import { isAbroad, moneyRow } from "./money";
import { MoneyFigure } from "./money-table";

const LEVEL_TONE: Record<OddsLevel, string> = {
  reach: "bg-danger-soft text-danger",
  target: "bg-warn-soft text-warn",
  likely: "bg-accent-soft text-accent",
  unrated: "bg-bg text-muted",
};

/** A college's odds and cost on its own page, with the way to the full Strategy page. */
export function StrategySummary({
  college,
  entry,
  strategyHref,
}: {
  college: CollegeRow;
  /** The college's catalog match (matchCollege), or null. */
  entry: CatalogEntry | null;
  strategyHref: string;
}) {
  // `select("*")` returns the strategy columns only once migration 20260928 has run.
  const migrated = "chance_percent" in college;
  const chance = chanceOf(college, entry);
  const money = moneyRow(college, entry);
  const abroad = isAbroad(college);

  return (
    <section aria-labelledby="strategy-heading" className="card mb-10 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="strategy-heading" className="font-serif text-xl">Strategy</h2>
        <Link href={strategyHref} className="text-sm text-muted hover:text-ink">All colleges by odds →</Link>
      </div>
      <dl className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="label">Chance</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-lg tabular-nums">{chance.percent === null ? "—" : formatPercent(chance.percent)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${LEVEL_TONE[chance.level]}`}>{LEVEL_LABEL[chance.level]}</span>
          </dd>
          <dd className="mt-0.5 text-xs text-muted">
            {chance.source ? SOURCE_LABEL[chance.source] : abroad ? "Decided by stated criteria, not a rate" : "No estimate or published rate yet"}
          </dd>
        </div>
        <div>
          <dt className="label">Sticker / yr</dt>
          <dd className="text-lg"><MoneyFigure figure={money.sticker} /></dd>
        </div>
        <div>
          <dt className="label">Net / yr</dt>
          <dd className="text-lg"><MoneyFigure figure={money.net} /></dd>
          {money.note && <dd className="mt-0.5 text-xs text-muted">{money.note}</dd>}
        </div>
      </dl>
      {college.chance_note && <p className="mt-3 text-sm text-muted">{college.chance_note}</p>}
      {abroad && college.intl_criterion && (
        <p className="mt-3 text-sm"><span className="text-muted">What decides it:</span> {college.intl_criterion}</p>
      )}
      {!migrated && (
        <p className="mt-3 text-xs text-warn">Run the latest database update to use AI odds and your own cost figures.</p>
      )}
    </section>
  );
}
