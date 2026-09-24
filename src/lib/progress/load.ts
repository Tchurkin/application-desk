import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgressCollege, ProgressPiece } from "./lanes";

/*
 * What the Progress board reads. Used by the page on the server and again by the board in the
 * browser when the tab regains focus, so it can't live in the server-only queries module.
 */

const COLLEGE_COLS = "id, name, deadline";
const PIECE_COLS = "id, college_id, title, status, word_count, char_count, limit_kind, limit_value, sort, created_at";
/** Added by migration 20260928. */
const PIECE_NEW_COLS = ", due";

export interface ProgressData {
  colleges: ProgressCollege[];
  pieces: ProgressPiece[];
  /** The database is a migration behind: no per-piece due dates, and pieces aren't streamed live. */
  behind: boolean;
}

/** Postgres "undefined column": the database is a migration behind the code. */
const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";

export async function loadProgress(supabase: SupabaseClient, deskId: string): Promise<ProgressData> {
  const piecesQuery = (cols: string) =>
    supabase.from("pieces").select(cols).eq("desk_id", deskId).order("sort").order("created_at");
  const [colleges, first] = await Promise.all([
    supabase.from("colleges").select(COLLEGE_COLS).eq("desk_id", deskId).order("name"),
    piecesQuery(PIECE_COLS + PIECE_NEW_COLS),
  ]);
  let pieces = first;
  const behind = missingColumn(pieces.error);
  if (behind) pieces = await piecesQuery(PIECE_COLS);
  if (colleges.error) throw colleges.error;
  if (pieces.error) throw pieces.error;
  return {
    colleges: colleges.data as ProgressCollege[],
    pieces: pieces.data as unknown as ProgressPiece[],
    behind,
  };
}
