import type { SupabaseClient } from "@supabase/supabase-js";
import { countWords } from "@/lib/domain/count";
import { MINUTE, trimHistory } from "@/lib/domain/history";

/** While someone is writing, save a version at most this often. */
export const SNAPSHOT_EVERY = 2 * MINUTE;

export interface VersionRow {
  id: string;
  at: string;
  author: string;
  words: number;
  size: number;
}

export async function listVersions(supabase: SupabaseClient, pieceId: string): Promise<VersionRow[]> {
  const { data, error } = await supabase
    .from("piece_versions")
    .select("id, at, author, words, size")
    .eq("piece_id", pieceId)
    .order("at", { ascending: false });
  if (error) throw error;
  return data as VersionRow[];
}

export async function loadVersion(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("piece_versions").select("content, plain_text").eq("id", id).single();
  if (error) throw error;
  return data as { content: unknown; plain_text: string };
}

/** Save a version, then thin the piece's history. */
export async function saveVersion(
  supabase: SupabaseClient,
  pieceId: string,
  author: string,
  content: unknown,
  text: string,
): Promise<boolean> {
  const { error } = await supabase.from("piece_versions").insert({
    piece_id: pieceId,
    author,
    content,
    plain_text: text,
    words: countWords(text),
    size: JSON.stringify(content).length,
  });
  // A deleted piece refuses the insert; nothing to thin.
  if (error) return false;
  const all = await listVersions(supabase, pieceId);
  const keep = new Set(trimHistory(all.map((v) => ({ ...v, at: Date.parse(v.at) })), Date.now()).map((v) => v.id));
  const drop = all.filter((v) => !keep.has(v.id)).map((v) => v.id);
  if (drop.length) await supabase.from("piece_versions").delete().in("id", drop);
  return true;
}
