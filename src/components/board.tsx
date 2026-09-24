import Link from "next/link";
import { StatusPill } from "@/components/status-pill";
import { APP_SYSTEMS, buildBoard, daysUntil, labelOf, ROUNDS, type College, type PieceSummary } from "@/lib/domain/colleges";

function Due({ date, today }: { date: string | null; today: string }) {
  if (!date) return <span className="text-muted">No deadline</span>;
  const d = daysUntil(date, today);
  const when = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const tone = d < 0 ? "text-muted" : d <= 7 ? "text-danger font-medium" : d <= 21 ? "text-warn" : "text-ink";
  return (
    <span className={tone}>
      {when} · {d < 0 ? "passed" : d === 0 ? "today" : `${d} day${d === 1 ? "" : "s"}`}
    </span>
  );
}

/** Every college in deadline order, fully submitted ones last. */
export function Board({
  colleges,
  pieces,
  today,
  pieceHref,
  collegeHref,
}: {
  colleges: College[];
  pieces: PieceSummary[];
  today: string;
  pieceHref: (id: string) => string;
  collegeHref?: (id: string) => string;
}) {
  const board = buildBoard(colleges, pieces);
  if (board.length === 0) return <p className="card px-4 py-6 text-muted">No colleges yet.</p>;
  return (
    <ol className="flex flex-col gap-3" aria-label="Colleges by deadline">
      {board.map(({ college, pieces: ps, done, total, submitted }) => (
        <li key={college.id} data-college={college.id} className={`card px-4 py-3 ${submitted ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            {collegeHref ? (
              <Link href={collegeHref(college.id)} className="text-lg font-medium hover:underline">
                {college.name}
              </Link>
            ) : (
              <span className="text-lg font-medium">{college.name}</span>
            )}
            <span className="text-sm"><Due date={college.deadline} today={today} /></span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{labelOf(ROUNDS, college.round)}</span>
            <span>{labelOf(APP_SYSTEMS, college.app_system)}</span>
            {college.ai_policy === "no_drafting" && <span className="text-warn">No AI drafting</span>}
            {college.materials_deadline && <span>Materials by {college.materials_deadline}</span>}
            <span>{total === 0 ? "No pieces yet" : `${done}/${total} submitted`}</span>
          </div>
          {total > 0 && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg" aria-hidden>
              <div className="h-full bg-accent" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          )}
          {ps.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {ps.map((p) => (
                <li key={p.id}>
                  <Link href={pieceHref(p.id)} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm hover:border-muted">
                    <span className="max-w-56 truncate">{p.title}</span>
                    <StatusPill status={p.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

export function PieceChips({ pieces, pieceHref }: { pieces: PieceSummary[]; pieceHref: (id: string) => string }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-2">
      {pieces.map((p) => (
        <li key={p.id}>
          <Link href={pieceHref(p.id)} className="flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1 text-sm hover:border-muted">
            {p.title} <StatusPill status={p.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
