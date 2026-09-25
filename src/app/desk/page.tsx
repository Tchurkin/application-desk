import Link from "next/link";
import { MasterBoard } from "@/components/board/master-board";
import { moneyRow, sortByCost } from "@/components/board/money";
import { MoneyTable } from "@/components/board/money-table";
import { StatTiles } from "@/components/board/stat-tiles";
import { boardStats } from "@/components/board/summary";
import { CollegeFields } from "@/components/college-form";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { checkCommonApp, COMMON_APP_MAX } from "@/lib/domain/colleges";
import { loadProgress } from "@/lib/progress/load";
import { matchCollege } from "@/lib/strategy/catalog";
import { requireDesk } from "@/lib/supabase/server";
import { addCollege, addPiece } from "./actions";

export default async function BoardPage() {
  const { supabase, userId, desk } = await requireDesk();
  const [{ colleges, pieces }, board, { data: profile }] = await Promise.all([
    loadDesk(supabase, desk.id),
    loadProgress(supabase, desk.id),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
  ]);
  const today = todayISO();
  const ca = checkCommonApp(colleges);
  const money = sortByCost(colleges.map((c) => moneyRow(c, matchCollege(c.name, c.scorecard_id))));
  // loadDesk selects "*": the cost columns are missing until migration 20260928 has run.
  const costColumns = colleges.length === 0 || "cost_net" in colleges[0];

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-3xl">
          {profile?.display_name ? `${profile.display_name}'s board` : "Your board"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <a href="#add-college" className="btn">
            Add a college
          </a>
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

      <MasterBoard
        deskId={desk.id}
        initial={{
          colleges: board.colleges,
          pieces: board.pieces,
          recommenders: board.recommenders,
          letters: board.letters,
          lettersReady: board.lettersReady,
        }}
        serverToday={today}
        base="/desk"
        canWrite
        collegeLinks
        behind={board.behind}
      />

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <section className="card px-4 py-3" aria-labelledby="independent-h">
          <h2 id="independent-h" className="font-medium">Add an independent piece</h2>
          <p className="mb-3 text-sm text-muted">Writing not tied to one college, like your personal statement.</p>
          <form action={addPiece.bind(null, null)} className="flex flex-wrap gap-2">
            <input className="field max-w-xs flex-1" name="title" placeholder="e.g. Personal essay" required aria-label="New independent piece title" />
            <input className="field w-24" name="limit_value" type="number" min={1} placeholder="650" aria-label="Word limit" />
            <input type="hidden" name="limit_kind" value="words" />
            <button className="btn" type="submit">Add piece</button>
          </form>
        </section>
        <details id="add-college" className="card px-4 py-3" open={colleges.length === 0}>
          <summary className="cursor-pointer font-medium">Add a college</summary>
          <form action={addCollege} className="mt-4 flex flex-col gap-4">
            <CollegeFields />
            <div><button className="btn btn-primary" type="submit">Add college</button></div>
          </form>
        </details>
      </div>

      {colleges.length > 0 && (
        <div className="mt-10">
          <MoneyTable rows={money} needsUpdate={!costColumns} />
        </div>
      )}
    </main>
  );
}
