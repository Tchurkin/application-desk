import { formatUSD, type Figure, type MoneyRow } from "./money";

const AVG_HINT = "The college's average for all students (U.S. College Scorecard), not your price.";

/** A yearly dollar figure, marked "avg" when it is the catalog's average rather than the student's own. */
export function MoneyFigure({ figure }: { figure: Figure | null }) {
  if (!figure) return <span className="text-muted">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-mono tabular-nums">{formatUSD(figure.amount)}</span>
      {figure.avg && (
        <abbr title={AVG_HINT} className="ml-1 text-xs text-muted no-underline">
          avg
        </abbr>
      )}
    </span>
  );
}

/** Sticker and net cost per year for each college, cheapest net first. */
export function MoneyTable({ rows, needsUpdate }: { rows: MoneyRow[]; needsUpdate: boolean }) {
  const anyAvg = rows.some((r) => r.sticker?.avg || r.net?.avg);
  return (
    <section aria-labelledby="money-heading" className="mt-10">
      <h2 id="money-heading" className="mb-1 font-serif text-xl">Money</h2>
      <p className="mb-3 text-sm text-muted">
        A year at each college: the sticker price, and the net price after grants and aid. Each
        college&apos;s net price calculator gives your own figure.
      </p>
      <div className="card overflow-x-auto">
        <table aria-labelledby="money-heading" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th scope="col" className="px-3 py-2 font-medium">College</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Sticker / yr</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Net / yr</th>
              <th scope="col" className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <th scope="row" className="px-3 py-2 text-left font-medium">{r.name}</th>
                <td className="px-3 py-2 text-right"><MoneyFigure figure={r.sticker} /></td>
                <td className="px-3 py-2 text-right"><MoneyFigure figure={r.net} /></td>
                <td className="px-3 py-2 text-muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {anyAvg && <p className="mt-2 text-xs text-muted">avg: {AVG_HINT}</p>}
      {needsUpdate && (
        <p className="mt-2 text-xs text-warn">Run the latest database update to use your own and the AI&apos;s cost figures.</p>
      )}
    </section>
  );
}
