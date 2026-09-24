import Link from "next/link";
import { notFound } from "next/navigation";
import { CollegeFields } from "@/components/college-form";
import { ConfirmButton } from "@/components/confirm-button";
import { StatusPill } from "@/components/status-pill";
import { COLLEGE_COLS, PIECE_SUMMARY_COLS, type CollegeRow, type PieceRow } from "@/lib/data/queries";
import { requireDesk } from "@/lib/supabase/server";
import { addPiece, deleteCollege, updateCollege } from "../../actions";

export default async function CollegePage(props: PageProps<"/desk/college/[id]">) {
  const { id } = await props.params;
  const { supabase } = await requireDesk();
  const [{ data: college }, { data: pieces }] = await Promise.all([
    supabase.from("colleges").select(COLLEGE_COLS).eq("id", id).maybeSingle<CollegeRow>(),
    supabase.from("pieces").select(PIECE_SUMMARY_COLS).eq("college_id", id).order("sort").order("created_at"),
  ]);
  if (!college) notFound();
  const list = (pieces ?? []) as PieceRow[];

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/desk" className="text-sm text-muted">← Board</Link>
      <h1 className="mt-2 mb-6 font-serif text-3xl">{college.name}</h1>

      <section className="mb-10">
        <h2 className="mb-3 font-serif text-xl">Pieces of writing</h2>
        {list.length === 0 ? (
          <p className="mb-4 text-sm text-muted">No pieces yet. Add each essay and short answer this college asks for.</p>
        ) : (
          <ul className="mb-4 flex flex-col gap-2">
            {list.map((p) => (
              <li key={p.id}>
                <Link href={`/desk/piece/${p.id}`} className="card flex items-center justify-between gap-3 px-3 py-2 hover:border-muted">
                  <span className="truncate">{p.title}</span>
                  <span className="flex items-center gap-3 text-sm text-muted">
                    {p.limit_kind !== "none" && p.limit_value
                      ? `${p.word_count}/${p.limit_value}${p.limit_kind === "chars" ? " chars" : " words"}`
                      : `${p.word_count} words`}
                    <StatusPill status={p.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <form action={addPiece.bind(null, college.id)} className="card flex flex-col gap-3 px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem]">
            <div>
              <label className="label" htmlFor="title">New piece</label>
              <input className="field" id="title" name="title" required placeholder="e.g. Why this college?" />
            </div>
            <div>
              <label className="label" htmlFor="limit_value">Limit</label>
              <input className="field" id="limit_value" name="limit_value" type="number" min={1} placeholder="250" />
            </div>
            <div>
              <label className="label" htmlFor="limit_kind">Counted in</label>
              <select className="field" id="limit_kind" name="limit_kind" defaultValue="words">
                <option value="words">Words</option>
                <option value="chars">Characters</option>
                <option value="none">No limit</option>
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="prompt">Prompt</label>
            <textarea className="field" id="prompt" name="prompt" rows={2} placeholder="Paste the question exactly as the college asks it." />
          </div>
          <div><button className="btn btn-primary" type="submit">Add piece</button></div>
        </form>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 font-serif text-xl">Details</h2>
        <form action={updateCollege.bind(null, college.id)} className="card flex flex-col gap-4 px-4 py-4">
          <CollegeFields college={college} />
          <div>
            <label className="label" htmlFor="research">Your research notes</label>
            <textarea
              className="field"
              id="research"
              name="research"
              rows={5}
              defaultValue={college.research}
              placeholder="Programs, professors, clubs, things you learned on a visit. Used as context if you turn on the counselor."
            />
          </div>
          <div><button className="btn btn-primary" type="submit">Save details</button></div>
        </form>
      </section>

      <ConfirmButton
        label="Delete college"
        question={`Delete ${college.name} and all ${list.length} of its pieces, with their history?`}
        onConfirm={deleteCollege.bind(null, college.id)}
      />
    </main>
  );
}
