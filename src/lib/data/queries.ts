import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { College, PieceSummary } from "@/lib/domain/colleges";

export const COLLEGE_COLS =
  "id, name, app_system, round, deadline, materials_deadline, ai_policy, needs_letters, research";
export const PIECE_SUMMARY_COLS = "id, college_id, title, status, word_count, limit_kind, limit_value, sort, created_at";

export type CollegeRow = College & { research: string };
export type PieceRow = PieceSummary & { limit_kind: "words" | "chars" | "none"; limit_value: number | null };

export async function loadDesk(supabase: SupabaseClient, deskId: string) {
  const [colleges, pieces] = await Promise.all([
    supabase.from("colleges").select(COLLEGE_COLS).eq("desk_id", deskId).order("name"),
    supabase.from("pieces").select(PIECE_SUMMARY_COLS).eq("desk_id", deskId).order("sort").order("created_at"),
  ]);
  if (colleges.error) throw colleges.error;
  if (pieces.error) throw pieces.error;
  return { colleges: colleges.data as CollegeRow[], pieces: pieces.data as PieceRow[] };
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
