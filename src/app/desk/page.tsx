import Link from "next/link";
import { Board, PieceChips } from "@/components/board";
import { CollegeFields } from "@/components/college-form";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { checkCommonApp, COMMON_APP_MAX } from "@/lib/domain/colleges";
import { requireDesk } from "@/lib/supabase/server";
import { addCollege, addPiece } from "./actions";

export default async function BoardPage() {
  const { supabase, userId, desk } = await requireDesk();
  const { colleges, pieces } = await loadDesk(supabase, desk.id);
  const { data: profile } = await supabase.from("profiles").select("display_name, last_piece_id").eq("id", userId).single();
  const ca = checkCommonApp(colleges);
  const shared = pieces.filter((p) => !p.college_id);
  const last = pieces.find((p) => p.id === profile?.last_piece_id);

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

      {colleges.length === 0 ? (
        <p className="card px-4 py-6 text-muted">No colleges yet. Add your first one below.</p>
      ) : (
        <Board
          colleges={colleges}
          pieces={pieces}
          today={todayISO()}
          pieceHref={(id) => `/desk/piece/${id}`}
          collegeHref={(id) => `/desk/college/${id}`}
        />
      )}

      <section className="mt-10">
        <h2 className="mb-2 font-serif text-xl">Shared pieces</h2>
        <p className="mb-3 text-sm text-muted">Writing that isn&apos;t tied to one college, like the Common App personal essay.</p>
        <PieceChips pieces={shared} pieceHref={(id) => `/desk/piece/${id}`} />
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
