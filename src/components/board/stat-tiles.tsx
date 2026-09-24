import { shortDate, urgencyOf } from "./due";
import { URGENCY_TEXT } from "./due-tag";
import type { BoardStats } from "./summary";

/** The Board's summary: colleges, pieces sent, words written, and the next thing due. */
export function StatTiles({ stats, today }: { stats: BoardStats; today: string }) {
  const { next } = stats;
  const tiles = [
    {
      id: "colleges",
      label: "Colleges",
      value: String(stats.colleges),
      sub: stats.collegesSubmitted > 0 ? `${stats.collegesSubmitted} fully submitted` : "",
    },
    {
      id: "pieces",
      label: "Pieces submitted",
      value: `${stats.submitted}/${stats.pieces}`,
      sub: stats.final > 0 ? `${stats.final} final, not yet sent` : "",
    },
    { id: "words", label: "Words written", value: stats.words.toLocaleString("en-US"), sub: "" },
    {
      id: "next",
      label: "Next deadline",
      value: next ? shortDate(next.date, today) : "—",
      tone: next ? URGENCY_TEXT[urgencyOf(next.days)] : "text-muted",
      sub: next
        ? `${next.days === 0 ? "Today" : `${next.days} day${next.days === 1 ? "" : "s"} left`} · ${next.label}`
        : "Nothing upcoming",
    },
  ];
  return (
    <section aria-label="At a glance" className="mb-8">
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
        {tiles.map((t) => (
          <div key={t.id} data-testid={`tile-${t.id}`} className="card min-w-0 px-4 py-3">
            <dt className="label">{t.label}</dt>
            <dd className={`font-mono text-2xl tabular-nums ${t.tone ?? ""}`}>{t.value}</dd>
            {t.sub && (
              <dd className="mt-0.5 truncate text-xs text-muted" title={t.sub}>
                {t.sub}
              </dd>
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}
