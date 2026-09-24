import Link from "next/link";
import { CollegeFields } from "@/components/college-form";
import { StatusPill } from "@/components/status-pill";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { APP_SYSTEMS, buildBoard, checkCommonApp, COMMON_APP_MAX, daysUntil, labelOf, ROUNDS } from "@/lib/domain/colleges";
import { requireDesk } from "@/lib/supabase/server";
import { addCollege, addPiece } from "./actions";

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

export default async function BoardPage() {
  const { supabase, userId, desk } = await requireDesk();
  const { colleges, pieces } = await loadDesk(supabase, desk.id);
  const { data: profile } = await supabase.from("profiles").select("display_name, last_piece_id").eq("id", userId).single();
  const board = buildBoard(colleges, pieces);
  const ca = checkCommonApp(colleges);
  const shared = pieces.filter((p) => !p.college_id);
  const last = pieces.find((p) => p.id === profile?.last_piece_id);
  const today = todayISO();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl">
          {profile?.display_name ? `${profile.display_name}'s board` : "Your board"}
        </h1>
        {last && (
          <Link href={`/desk/piece/${last.id}`} className="btn">
            Continue: {last.title} →
          </Link>
        )}
      </div>

      {ca.over && (
        <div role="alert" className="mb-6 rounded-lg border border-warn bg-warn-soft px-4 py-3 text-sm">
          <p className="font-medium text-warn">
            {ca.count} colleges use the Common App, and it allows only {COMMON_APP_MAX}.
          </p>
          <p className="mt-1">
            Move {ca.count - COMMON_APP_MAX} to their own application or another system.
            {ca.movable.length > 0 && (
              <> The easiest to move are the ones that don&apos;t need letters: {ca.movable.map((c) => c.name).join(", ")}.</>
            )}
          </p>
        </div>
      )}

      {board.length === 0 ? (
        <p className="card px-4 py-6 text-muted">No colleges yet. Add your first one below.</p>
      ) : (
        <ol className="flex flex-col gap-3" aria-label="Colleges by deadline">
          {board.map(({ college, pieces: ps, done, total, submitted }) => (
            <li key={college.id} data-college={college.id} className={`card px-4 py-3 ${submitted ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/desk/college/${college.id}`} className="text-lg font-medium hover:underline">
                  {college.name}
                </Link>
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
                      <Link href={`/desk/piece/${p.id}`} className="flex items-center gap-2 rounded-md border border-line px-2 py-1 text-sm hover:border-muted">
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
      )}

      <section className="mt-10">
        <h2 className="mb-2 font-serif text-xl">Shared pieces</h2>
        <p className="mb-3 text-sm text-muted">Writing that isn&apos;t tied to one college, like the Common App personal essay.</p>
        <ul className="mb-3 flex flex-wrap gap-2">
          {shared.map((p) => (
            <li key={p.id}>
              <Link href={`/desk/piece/${p.id}`} className="flex items-center gap-2 rounded-md border border-line bg-panel px-2 py-1 text-sm hover:border-muted">
                {p.title} <StatusPill status={p.status} />
              </Link>
            </li>
          ))}
        </ul>
        <form action={addPiece.bind(null, null)} className="flex flex-wrap gap-2">
          <input className="field max-w-xs" name="title" placeholder="e.g. Personal essay" required aria-label="New shared piece title" />
          <input className="field w-24" name="limit_value" type="number" min={1} placeholder="650" aria-label="Word limit" />
          <input type="hidden" name="limit_kind" value="words" />
          <button className="btn" type="submit">Add piece</button>
        </form>
      </section>

      <details className="card mt-10 px-4 py-3" open={colleges.length === 0}>
        <summary className="cursor-pointer font-medium">Add a college</summary>
        <form action={addCollege} className="mt-4 flex flex-col gap-4">
          <CollegeFields />
          <div><button className="btn btn-primary" type="submit">Add college</button></div>
        </form>
      </details>
    </main>
  );
}
