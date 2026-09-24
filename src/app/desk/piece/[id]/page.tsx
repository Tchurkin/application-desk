import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDesk } from "@/lib/supabase/server";
import { PieceEditor, type PieceMeta } from "./piece-editor";

export default async function PiecePage(props: PageProps<"/desk/piece/[id]">) {
  const { id } = await props.params;
  const { supabase, userId, desk } = await requireDesk();
  const { data: piece } = await supabase
    .from("pieces")
    .select("id, college_id, title, prompt, limit_kind, limit_value, status, notes")
    .eq("id", id)
    .maybeSingle<PieceMeta>();
  if (!piece) notFound();

  const [{ data: college }, { data: siblings }, { data: profile }] = await Promise.all([
    piece.college_id
      ? supabase.from("colleges").select("id, name, ai_policy, research").eq("id", piece.college_id).maybeSingle()
      : Promise.resolve({ data: null }),
    piece.college_id
      ? supabase.from("pieces").select("id, title").eq("college_id", piece.college_id).order("sort").order("created_at")
      : supabase.from("pieces").select("id, title").is("college_id", null).order("sort").order("created_at"),
    supabase.from("profiles").select("display_name").eq("id", userId).single(),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <nav className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href="/desk">Board</Link>
        <span>/</span>
        {college ? <Link href={`/desk/college/${college.id}`}>{college.name}</Link> : <span>Shared pieces</span>}
      </nav>
      {siblings && siblings.length > 1 && (
        <div role="tablist" aria-label="Pieces" className="mb-4 flex flex-wrap gap-1 border-b border-line">
          {siblings.map((s) => (
            <Link
              key={s.id}
              role="tab"
              aria-selected={s.id === piece.id}
              href={`/desk/piece/${s.id}`}
              className={`-mb-px max-w-60 truncate rounded-t-md border px-3 py-1.5 text-sm ${
                s.id === piece.id ? "border-line border-b-panel bg-panel" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {s.title}
            </Link>
          ))}
        </div>
      )}
      <PieceEditor
        deskId={desk.id}
        key={piece.id}
        piece={piece}
        userId={userId}
        author={profile?.display_name || "Student"}
        collegeName={college?.name ?? null}
        aiPolicy={college?.ai_policy === "no_drafting" ? "no_drafting" : "allowed"}
        research={college?.research ?? ""}
      />
    </main>
  );
}
