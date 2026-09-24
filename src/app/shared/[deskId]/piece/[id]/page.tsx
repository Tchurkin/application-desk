import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PieceEditor, type PieceMeta } from "@/app/desk/piece/[id]/piece-editor";
import { requireDeskAccess } from "@/lib/supabase/server";

export default async function SharedPiece(props: PageProps<"/shared/[deskId]/piece/[id]">) {
  const { deskId, id } = await props.params;
  const { supabase, userId, role, name } = await requireDeskAccess(deskId);
  if (role === "owner") redirect(`/desk/piece/${id}`);
  const { data: piece } = await supabase
    .from("pieces")
    .select("id, desk_id, college_id, title, prompt, limit_kind, limit_value, status, notes")
    .eq("id", id)
    .eq("desk_id", deskId)
    .maybeSingle<PieceMeta & { desk_id: string }>();
  if (!piece) notFound();
  const [{ data: college }, { data: siblings }] = await Promise.all([
    piece.college_id
      ? supabase.from("colleges").select("id, name").eq("id", piece.college_id).maybeSingle()
      : Promise.resolve({ data: null }),
    piece.college_id
      ? supabase.from("pieces").select("id, title").eq("college_id", piece.college_id).order("sort").order("created_at")
      : supabase.from("pieces").select("id, title").eq("desk_id", deskId).is("college_id", null).order("sort").order("created_at"),
  ]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <nav className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Link href={`/shared/${deskId}`}>Board</Link>
        <span>/</span>
        <span>{college?.name ?? "Shared pieces"}</span>
      </nav>
      {siblings && siblings.length > 1 && (
        <div role="tablist" aria-label="Pieces" className="mb-4 flex flex-wrap gap-1 border-b border-line">
          {siblings.map((s) => (
            <Link
              key={s.id}
              role="tab"
              aria-selected={s.id === piece.id}
              href={`/shared/${deskId}/piece/${s.id}`}
              className={`-mb-px max-w-60 truncate rounded-t-md border px-3 py-1.5 text-sm ${
                s.id === piece.id ? "border-line border-b-panel bg-panel" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {s.title}
            </Link>
          ))}
        </div>
      )}
      <PieceEditor key={piece.id} piece={piece} userId={userId} author={name || "Guest"} collegeName={college?.name ?? null} role={role} />
    </main>
  );
}
