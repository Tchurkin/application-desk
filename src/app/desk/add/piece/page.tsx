import Link from "next/link";
import { requireDesk } from "@/lib/supabase/server";
import { addPiece } from "../../actions";

export const metadata = { title: "Add an independent piece" };

export default async function AddPiecePage() {
  await requireDesk();
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <nav className="mb-2 text-sm text-muted">
        <Link href="/desk">Board</Link>
      </nav>
      <h1 className="mb-1 font-serif text-3xl">Add an independent piece</h1>
      <p className="mb-5 text-sm text-muted">Writing not tied to one college, like your personal statement or an activities list.</p>
      <form action={addPiece.bind(null, null)} className="card flex flex-col gap-4 px-4 py-4">
        <div>
          <label className="label" htmlFor="title">Title</label>
          <input className="field" id="title" name="title" placeholder="e.g. Personal statement" required maxLength={300} />
        </div>
        <div>
          <label className="label" htmlFor="prompt">Prompt (optional)</label>
          <textarea className="field" id="prompt" name="prompt" rows={3} placeholder="Paste the question exactly as it's asked." />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label" htmlFor="limit_value">Limit (optional)</label>
            <input className="field w-28" id="limit_value" name="limit_value" type="number" min={1} placeholder="650" />
          </div>
          <select className="field w-auto" name="limit_kind" defaultValue="words" aria-label="Counted in">
            <option value="words">words</option>
            <option value="chars">characters</option>
          </select>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" type="submit">Add piece</button>
          <Link href="/desk" className="btn">Cancel</Link>
        </div>
      </form>
    </main>
  );
}
