import { redirect } from "next/navigation";
import { loadDesk } from "@/lib/data/queries";
import { requireDesk } from "@/lib/supabase/server";
import { pieceToWrite } from "@/lib/write/rail";

/**
 * "Write" opens the piece the student was last on; otherwise the first unfinished piece with
 * the soonest due date; otherwise the board.
 */
export default async function WritePage() {
  const { supabase, userId, desk } = await requireDesk();
  const [{ data: profile }, { colleges, pieces }] = await Promise.all([
    supabase.from("profiles").select("last_piece_id").eq("id", userId).single(),
    loadDesk(supabase, desk.id),
  ]);
  const id = pieceToWrite(colleges, pieces, profile?.last_piece_id);
  redirect(id ? `/desk/piece/${id}` : "/desk");
}
