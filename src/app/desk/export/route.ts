import type { SupabaseClient } from "@supabase/supabase-js";
import { buildArchive, type ExportPiece } from "@/lib/export/archive";
import { docFromRows, flatten } from "@/lib/suggest/anchor-text";
import { requireDesk } from "@/lib/supabase/server";

/*
 * "Download all my writing" (Settings → Account): a zip of every piece as a Word file, and the
 * whole desk as JSON. Each piece's text is rebuilt from its saved document and every edit since,
 * exactly as the editor shows it.
 */

export const dynamic = "force-dynamic";

const PAGE = 1000;

/** Every row a query returns, a page at a time (the API returns at most 1000 at once). */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** A table that may not exist yet on an older database: empty then. */
async function maybe<T>(supabase: SupabaseClient, table: string, deskId: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("*").eq("desk_id", deskId);
  return error ? [] : ((data ?? []) as T[]);
}

interface PieceRow {
  id: string;
  college_id: string | null;
  title: string;
  prompt: string;
  notes: string;
  doc_state: string;
  plain_text: string;
  [k: string]: unknown;
}

export async function GET() {
  const { supabase, userId, desk } = await requireDesk();
  // The edit log first: a compaction landing afterwards only moves edits into doc_state, read
  // next (applying an edit twice does nothing).
  const updates: { id: number; piece_id: string; update: string }[] = [];
  for (let last = 0; ; ) {
    const { data, error } = await supabase
      .from("piece_updates")
      .select("id, piece_id, update, pieces!inner(desk_id)")
      .eq("pieces.desk_id", desk.id)
      .gt("id", last)
      .order("id")
      .limit(PAGE);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as { id: number; piece_id: string; update: string }[];
    updates.push(...rows);
    if (rows.length < PAGE) break;
    last = rows[rows.length - 1].id;
  }
  const [colleges, pieces, profile, sections, recommenders, letters] = await Promise.all([
    all<Record<string, unknown>>((a, b) => supabase.from("colleges").select("*").eq("desk_id", desk.id).order("name").range(a, b)),
    all<PieceRow>((a, b) => supabase.from("pieces").select("*").eq("desk_id", desk.id).order("sort").order("created_at").range(a, b)),
    supabase.from("profiles").select("*").eq("id", userId).single(),
    maybe<Record<string, unknown>>(supabase, "profile_sections", desk.id),
    maybe<Record<string, unknown>>(supabase, "recommenders", desk.id),
    maybe<Record<string, unknown>>(supabase, "letters", desk.id),
  ]);
  const byPiece = new Map<string, string[]>();
  for (const u of updates) byPiece.set(u.piece_id, [...(byPiece.get(u.piece_id) ?? []), u.update]);

  const collegeName = new Map(colleges.map((c) => [c.id as string, c.name as string]));
  const textOf = (p: PieceRow) => {
    try {
      const doc = docFromRows(p.doc_state, byPiece.get(p.id) ?? []);
      const { text } = flatten(doc);
      doc.destroy();
      return text;
    } catch {
      return p.plain_text ?? "";
    }
  };
  const written: (ExportPiece & { id: string })[] = pieces.map((p) => ({
    id: p.id,
    title: p.title,
    college: p.college_id ? (collegeName.get(p.college_id) ?? "College") : null,
    prompt: p.prompt ?? "",
    notes: p.notes ?? "",
    text: textOf(p),
  }));

  const date = new Date().toISOString().slice(0, 10);
  const zip = buildArchive({
    deskTitle: desk.title,
    date,
    pieces: written,
    data: {
      exported: new Date().toISOString(),
      desk: desk.title,
      profile: profile.data
        ? Object.fromEntries(Object.entries(profile.data).filter(([k]) => !["id", "last_piece_id"].includes(k)))
        : null,
      profile_sections: sections,
      colleges,
      pieces: pieces.map(({ doc_state, plain_text, ...p }) => {
        void doc_state;
        void plain_text;
        return { ...p, text: written.find((w) => w.id === p.id)?.text ?? "" };
      }),
      recommenders,
      letters,
    },
  });

  return new Response(zip as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="Average App writing ${date}.zip"`,
      "cache-control": "no-store",
    },
  });
}
