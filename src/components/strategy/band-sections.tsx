import type { ReactNode } from "react";
import type { Strategy } from "@/lib/strategy/bands";
import type { StrategyCollegeView } from "@/lib/strategy/load";
import { IntlRow, ODDS_COLUMNS, OddsRow } from "./strategy-rows";

/*
 * The Strategy page's sections: Reach, Target and Likely always (an empty band still says so),
 * Unrated and Outside the US only when they have colleges. `editable` is false on a database
 * without the strategy columns, and would be for a read-only viewer.
 */

const TH = "px-3 py-2 font-medium";

function Section({ id, title, count, blurb, children }: { id: string; title: string; count: number; blurb: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`band-${id}`} className="mb-8">
      <div className="mb-1 flex flex-wrap items-baseline gap-2.5">
        <h2 id={`band-${id}`} className="font-serif text-xl">{title}</h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
          {count} {count === 1 ? "college" : "colleges"}
        </span>
      </div>
      <p className="mb-3 max-w-[70ch] text-sm text-muted">{blurb}</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}

function Head({ columns }: { columns: string[] }) {
  return (
    <thead className="bg-bg text-left font-mono text-[0.68rem] tracking-wide text-muted uppercase">
      <tr>
        {columns.map((c) => (
          <th key={c} scope="col" className={TH}>{c}</th>
        ))}
        <th scope="col" className={TH}><span className="sr-only">Edit</span></th>
      </tr>
    </thead>
  );
}

function Empty({ columns }: { columns: number }) {
  return (
    <tr className="border-t border-line">
      <td colSpan={columns} className="px-3 py-3 text-muted">None yet.</td>
    </tr>
  );
}

export function BandSections({ strategy, editable }: { strategy: Strategy<StrategyCollegeView>; editable: boolean }) {
  return (
    <>
      {strategy.bands
        .filter((b) => b.id !== "unrated" || b.rows.length > 0)
        .map((b) => (
          <Section key={b.id} id={b.id} title={b.title} count={b.rows.length} blurb={b.blurb}>
            <table className="w-full text-sm whitespace-nowrap">
              <Head columns={["College", "Chance", "Fit", "Campus life", "Reputation", "Cost per year"]} />
              <tbody>
                {b.rows.length === 0 ? (
                  <Empty columns={ODDS_COLUMNS} />
                ) : (
                  b.rows.map((r) => <OddsRow key={r.college.id} row={r} editable={editable} />)
                )}
              </tbody>
            </table>
          </Section>
        ))}
      {strategy.international.length > 0 && (
        <Section
          id="intl"
          title="Outside the US"
          count={strategy.international.length}
          blurb="No percentages here on purpose: these colleges usually admit on stated exam grades or a ranked selection rather than a holistic read, so what matters is the bar, the bill, and what is still unanswered."
        >
          <table className="w-full text-sm whitespace-nowrap">
            <Head columns={["College", "Course", "What decides it", "Cost a year", "Where it stands"]} />
            <tbody>
              {strategy.international.map((c) => (
                <IntlRow key={c.id} college={c} editable={editable} />
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
