import { formatUSD, type Figure } from "./money";

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
