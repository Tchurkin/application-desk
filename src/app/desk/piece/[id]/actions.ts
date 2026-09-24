"use server";
import { revalidatePath } from "next/cache";
import { countChars, countWords } from "@/lib/domain/count";
import { requireDesk } from "@/lib/supabase/server";
import { SupabaseUpdateStore } from "@/lib/sync/supabase-store";
import { copyFromRows } from "@/lib/write/copy-doc";
import { nextVersionTitle } from "@/lib/write/rail";

export type VersionResult = { ok: true; id: string; title: string; number: number } | { ok: false; error: string };

/** Postgres "undefined column" (or PostgREST's version of it): the database is a migration behind. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
const NEEDS_UPDATE = "Versions need the latest database update. Run it, then try again.";

/**
 * Start a new version of a piece: a new piece in the same college, linked to the original,
 * holding a copy of the text as it is saved right now. The original is left untouched.
 */
export async function makeVersion(pieceId: string): Promise<VersionResult> {
  const { supabase, desk } = await requireDesk();
  const { data: piece, error } = await supabase
    .from("pieces")
    .select("id, college_id, title, prompt, limit_kind, limit_value, sort, due, variant_of")
    .eq("id", pieceId)
    .maybeSingle();
  if (missingColumn(error)) return { ok: false, error: NEEDS_UPDATE };
  if (error) return { ok: false, error: error.message };
  if (!piece) return { ok: false, error: "This piece was deleted." };

  // Versions all point at the original, so a version of a version joins the same family.
  const rootId: string = piece.variant_of ?? piece.id;
  const { data: family, error: famError } = await supabase
    .from("pieces")
    .select("id, title")
    .or(`id.eq.${rootId},variant_of.eq.${rootId}`);
  if (famError) return { ok: false, error: famError.message };
  const root = family?.find((p) => p.id === rootId) ?? piece;
  const size = Math.max(1, family?.length ?? 1);

  const stored = await new SupabaseUpdateStore(supabase).load(pieceId);
  if (!stored) return { ok: false, error: "This piece was deleted." };
  const copy = copyFromRows(
    stored.state,
    stored.updates.map((u) => u.update),
  );

  const title = nextVersionTitle(root.title, size);
  const { data: made, error: insError } = await supabase
    .from("pieces")
    .insert({
      desk_id: desk.id,
      college_id: piece.college_id,
      title,
      prompt: piece.prompt,
      limit_kind: piece.limit_kind,
      limit_value: piece.limit_value,
      sort: piece.sort,
      due: piece.due,
      variant_of: rootId,
      status: "drafting",
      plain_text: copy.text,
      word_count: countWords(copy.text),
      char_count: countChars(copy.text),
    })
    .select("id")
    .single();
  if (missingColumn(insError)) return { ok: false, error: NEEDS_UPDATE };
  if (insError || !made) return { ok: false, error: insError?.message ?? "Couldn't make the version." };

  if (copy.update) {
    const { error: upError } = await supabase
      .from("piece_updates")
      .insert({ piece_id: made.id, client_id: "version-copy", update: copy.update });
    if (upError) {
      // A version without its text would be worse than none.
      await supabase.from("pieces").delete().eq("id", made.id);
      return { ok: false, error: upError.message };
    }
  }
  revalidatePath("/desk", "layout");
  return { ok: true, id: made.id, title, number: size + 1 };
}
