import { redirect } from "next/navigation";
import { dueOf, loadDesk } from "@/lib/data/queries";
import { requireDesk } from "@/lib/supabase/server";

/**
 * "Write" opens the piece the student was last on; otherwise the first unfinished piece with
 * the soonest due date; otherwise the board.
 */
export default async function WritePage() {
  const { supabase, userId, desk } = await requireDesk();
  const { data: profile } = await supabase.from("profiles").select("last_piece_id").eq("id", userId).single();
  const { colleges, pieces } = await loadDesk(supabase, desk.id);
  if (profile?.last_piece_id && pieces.some((p) => p.id === profile.last_piece_id)) {
    redirect(`/desk/piece/${profile.last_piece_id}`);
  }
  const byId = new Map(colleges.map((c) => [c.id, c]));
  const open = pieces
    .filter((p) => p.status !== "final" && p.status !== "submitted")
    .sort((a, b) => {
      const da = dueOf(a, a.college_id ? byId.get(a.college_id) : undefined) ?? "9999";
      const db = dueOf(b, b.college_id ? byId.get(b.college_id) : undefined) ?? "9999";
      return da < db ? -1 : da > db ? 1 : 0;
    });
  const first = open[0] ?? pieces[0];
  redirect(first ? `/desk/piece/${first.id}` : "/desk");
}
