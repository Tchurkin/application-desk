"use server";
import { revalidatePath } from "next/cache";
import * as Y from "yjs";
import { writeWhole } from "@/lib/connector/write";
import { countChars, countWords } from "@/lib/domain/count";
import { docFromRows } from "@/lib/suggest/anchor-text";
import { requireDesk } from "@/lib/supabase/server";
import { saveVersion } from "@/lib/sync/versions";

/*
 * Importing essays from Google Docs or files: each one becomes a new piece, or fills in a piece
 * already on the desk (its text before is kept in History). The text goes into the piece's Yjs
 * document the same way the connector writes it, so an open editor updates live.
 */

export interface ImportItem {
  title: string;
  text: string;
  collegeId: string | null;
  /** An existing piece to fill in, or null for a new one. */
  pieceId: string | null;
}

export interface ImportResult {
  imported: number;
  errors: string[];
  firstPieceId?: string;
}

const MAX_ITEMS = 100;
const MAX_TEXT = 200_000;

export async function importPieces(items: ImportItem[]): Promise<ImportResult> {
  const { supabase, desk } = await requireDesk();
  if (!Array.isArray(items) || items.length === 0) return { imported: 0, errors: ["Nothing to import."] };
  if (items.length > MAX_ITEMS) return { imported: 0, errors: [`Import at most ${MAX_ITEMS} pieces at a time.`] };

  const [{ data: colleges }, { data: pieces }] = await Promise.all([
    supabase.from("colleges").select("id").eq("desk_id", desk.id),
    supabase.from("pieces").select("id, status, doc_state").eq("desk_id", desk.id),
  ]);
  const collegeIds = new Set((colleges ?? []).map((c) => c.id as string));
  const byId = new Map((pieces ?? []).map((p) => [p.id as string, p as { id: string; status: string; doc_state: string }]));

  const errors: string[] = [];
  let imported = 0;
  let firstPieceId: string | undefined;

  for (const item of items) {
    const title = String(item.title ?? "").trim().slice(0, 300) || "Untitled";
    const text = String(item.text ?? "").slice(0, MAX_TEXT);
    const collegeId = item.collegeId && collegeIds.has(item.collegeId) ? item.collegeId : null;
    try {
      let pieceId = item.pieceId && byId.has(item.pieceId) ? item.pieceId : null;
      let ydoc: Y.Doc;
      let status = "not_started";
      if (pieceId) {
        const existing = byId.get(pieceId)!;
        status = existing.status;
        const { data: rows, error } = await supabase.from("piece_updates").select("update").eq("piece_id", pieceId).order("id");
        if (error) throw error;
        ydoc = docFromRows(existing.doc_state ?? "", (rows ?? []).map((r) => r.update as string));
      } else {
        const { data: made, error } = await supabase
          .from("pieces")
          .insert({ desk_id: desk.id, college_id: collegeId, title })
          .select("id")
          .single();
        if (error) throw error;
        pieceId = made.id as string;
        ydoc = new Y.Doc();
      }
      try {
        const r = writeWhole(ydoc, text);
        if (r.update) {
          // What was there before stays in the piece's History.
          if (r.before.trim()) await saveVersion(supabase, pieceId, "Before import", r.beforeJSON, r.before);
          const { error: upd } = await supabase.from("piece_updates").insert({ piece_id: pieceId, client_id: "import", update: r.update });
          if (upd) throw upd;
          await supabase
            .from("pieces")
            .update({
              plain_text: r.after,
              word_count: countWords(r.after),
              char_count: countChars(r.after),
              ...(status === "not_started" && r.after.trim() ? { status: "drafting" } : {}),
            })
            .eq("id", pieceId);
        }
      } finally {
        ydoc.destroy();
      }
      imported++;
      firstPieceId ??= pieceId;
    } catch (e) {
      errors.push(`${title}: ${(e as { message?: string }).message ?? "couldn't be imported"}`);
    }
  }

  revalidatePath("/desk");
  revalidatePath("/desk/write");
  return { imported, errors, firstPieceId };
}
