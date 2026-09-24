import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackendResult, Suggestion, SuggestionBackend, SuggestionStatus } from "./store";

export const SUGGESTION_COLS =
  "id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note, status, version, created_at";

/** Refusals that retrying won't fix: policy, trigger, or a deleted piece. */
function outcome(error: { code?: string } | null): BackendResult {
  if (!error) return "ok";
  if (error.code && ["42501", "23503", "P0001", "PGRST116"].includes(error.code)) return "rejected";
  return "retry";
}

export class SupabaseSuggestionBackend implements SuggestionBackend {
  constructor(private supabase: SupabaseClient) {}

  async list(pieceId: string) {
    const query = (cols: string) =>
      this.supabase.from("suggestions").select(cols).eq("piece_id", pieceId).eq("status", "open").order("created_at");
    let { data, error } = await query(SUGGESTION_COLS);
    // A database from before suggestion notes (migration 20260925) has no "note" column.
    if (error?.code === "42703") ({ data, error } = await query(SUGGESTION_COLS.replace(", note", "")));
    if (error) throw error;
    return data as unknown as Suggestion[];
  }

  async put(s: Suggestion) {
    const { error } = await this.supabase.from("suggestions").upsert(
      {
        id: s.id,
        piece_id: s.piece_id,
        author_name: s.author_name,
        source: s.source,
        kind: s.kind,
        anchor_from: s.anchor_from,
        anchor_to: s.anchor_to,
        quote: s.quote,
        body: s.body,
        version: s.version,
        created_at: s.created_at,
      },
      { onConflict: "id" },
    );
    return outcome(error);
  }

  async remove(id: string) {
    const { error } = await this.supabase.from("suggestions").delete().eq("id", id);
    return outcome(error);
  }

  async resolve(id: string, status: SuggestionStatus) {
    const { error } = await this.supabase.from("suggestions").update({ status }).eq("id", id);
    return outcome(error);
  }
}
