import { redirect } from "next/navigation";
import { loadDesk } from "@/lib/data/queries";
import { requireDeskAccess } from "@/lib/supabase/server";
import { pieceToWrite } from "@/lib/write/rail";

/** "Write" on a shared desk opens the unfinished piece due soonest; otherwise the board. */
export default async function SharedWritePage(props: PageProps<"/shared/[deskId]/write">) {
  const { deskId } = await props.params;
  const { supabase, role } = await requireDeskAccess(deskId);
  if (role === "owner") redirect("/desk/write");
  const { colleges, pieces } = await loadDesk(supabase, deskId);
  const id = pieceToWrite(colleges, pieces);
  redirect(id ? `/shared/${deskId}/piece/${id}` : `/shared/${deskId}`);
}
