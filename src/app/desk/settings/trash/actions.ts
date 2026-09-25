"use server";
import { revalidatePath } from "next/cache";
import { requireDesk } from "@/lib/supabase/server";

export type RestoreResult = { ok: true; kind: "piece" | "college"; id: string } | { ok: false; error: string };

/** Put something back from the Trash, with everything that went with it. */
export async function restoreFromTrash(item: string): Promise<RestoreResult> {
  const { supabase } = await requireDesk();
  const { data, error } = await supabase.rpc("restore_trash", { item });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/desk", "layout");
  const r = data as { kind: "piece" | "college"; id: string };
  return { ok: true, kind: r.kind, id: r.id };
}

/** Delete something from the Trash for good. */
export async function deleteForever(item: string): Promise<{ error?: string }> {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("trash").delete().eq("id", item);
  if (error) return { error: error.message };
  revalidatePath("/desk/settings/trash");
  return {};
}
