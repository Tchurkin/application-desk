import Link from "next/link";
import { Board, PieceChips } from "@/components/board";
import { DeadlinesTable } from "@/components/board/deadlines-table";
import { moneyRow, sortByCost } from "@/components/board/money";
import { MoneyTable } from "@/components/board/money-table";
import { StatTiles } from "@/components/board/stat-tiles";
import { boardStats, deadlineRows } from "@/components/board/summary";
import { CollegeFields } from "@/components/college-form";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { checkCommonApp, COMMON_APP_MAX } from "@/lib/domain/colleges";
import { matchCollege } from "@/lib/strategy/catalog";
import { requireDesk } from "@/lib/supabase/server";
import { addCollege, addPiece } from "./actions";

const pieceHref = (id: string) => `/desk/piece/${id}`;
const collegeHref = (id: string) => `/desk/college/${id}`;

export default async function BoardPage() {
  const { supabase, userId, desk } = await requireDesk();
  const [{ colleges, pieces }, { data: profile }] = await Promise.all([
    loadDesk(supabase, desk.id),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
  ]);
  const today = todayISO();
  const ca = checkCommonApp(colleges);
  const shared = pieces.filter((p) => !p.college_id);
  const money = sortByCost(colleges.map((c) => moneyRow(c, matchCollege(c.name, c.scorecard_id))));
  // loadDesk selects "*": the cost columns are missing until migration 20260928 has run.
  const costColumns = colleges.length === 0 || "cost_net" in colleges[0];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl">
          {profile?.display_name ? `${profile.display_name}'s board` : "Your board"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Link href="/desk/import" className="btn">
            Import essays
          </Link>
        </div>
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

      {(colleges.length > 0 || pieces.length > 0) && <StatTiles stats={boardStats(colleges, pieces, today)} today={today} />}

      {colleges.length === 0 ? (
        <p className="card px-4 py-6 text-muted">No colleges yet. Add your first one below.</p>
      ) : (
        <>
          <DeadlinesTable
            rows={deadlineRows(colleges, pieces, today)}
            today={today}
            pieceHref={pieceHref}
            collegeHref={collegeHref}
          />
          <section aria-labelledby="pieces-by-college-heading">
            <h2 id="pieces-by-college-heading" className="mb-3 font-serif text-xl">Pieces by college</h2>
            <Board colleges={colleges} pieces={pieces} today={today} pieceHref={pieceHref} collegeHref={collegeHref} />
          </section>
          <MoneyTable rows={money} needsUpdate={!costColumns} />
        </>
      )}

      <section className="mt-10">
        <h2 className="mb-1 font-serif text-xl">Independent pieces</h2>
        <p className="mb-2 text-sm text-muted">Pieces of their own, not tied to one college, like your personal statement.</p>
        <p className="mb-3 text-sm text-muted">Writing that isn&apos;t tied to one college, like the Common App personal essay.</p>
        <PieceChips pieces={shared} pieceHref={pieceHref} />
        <form action={addPiece.bind(null, null)} className="flex flex-wrap gap-2">
          <input className="field max-w-xs" name="title" placeholder="e.g. Personal essay" required aria-label="New independent piece title" />
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
