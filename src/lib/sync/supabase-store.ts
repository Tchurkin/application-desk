import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushResult, StoredUpdate, UpdateStore } from "./piece-sync";

const PAGE = 1000;

/** piece_updates / pieces.doc_state, through the signed-in user's row-level security. */
export class SupabaseUpdateStore implements UpdateStore {
  constructor(private supabase: SupabaseClient) {}

  async load(pieceId: string) {
    const { data: piece, error } = await this.supabase.from("pieces").select("doc_state").eq("id", pieceId).maybeSingle();
    if (error) throw error;
    if (!piece) return null;
    const updates: StoredUpdate[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error: e } = await this.supabase
        .from("piece_updates")
        .select("id, update, created_at")
        .eq("piece_id", pieceId)
        .order("id")
        .range(from, from + PAGE - 1);
      if (e) throw e;
      updates.push(...(data as StoredUpdate[]));
      if (data.length < PAGE) break;
    }
    return { state: piece.doc_state as string, updates };
  }

  async push(pieceId: string, clientId: string, update: string): Promise<PushResult> {
    const { error } = await this.supabase.from("piece_updates").insert({ piece_id: pieceId, client_id: clientId, update });
    if (!error) return "ok";
    // A deleted piece fails the foreign key, or the policy (its desk can no longer be found).
    if (error.code === "23503") return "gone";
    if (error.code === "42501") {
      const { data } = await this.supabase.from("pieces").select("id").eq("id", pieceId).maybeSingle();
      if (!data) return "gone";
    }
    return "retry";
  }

  async since(pieceId: string, afterId: number) {
    const { data, error } = await this.supabase
      .from("piece_updates")
      .select("id, update, created_at")
      .eq("piece_id", pieceId)
      .gt("id", afterId)
      .order("id")
      .limit(PAGE);
    if (error) throw error;
    return data as StoredUpdate[];
  }

  async compact(pieceId: string, state: string, throughId: number, cutoff: string) {
    const { error } = await this.supabase.rpc("compact_piece", {
      p: pieceId,
      state,
      through_id: throughId,
      cutoff,
    });
    if (error) throw error;
  }
}
