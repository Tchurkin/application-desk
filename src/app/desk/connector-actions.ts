"use server";
import { revalidatePath } from "next/cache";
import { requireDesk } from "@/lib/supabase/server";

export interface ConnectorState {
  token?: string;
  label?: string;
  error?: string;
}

export async function createConnectorLink(_prev: ConnectorState, f: FormData): Promise<ConnectorState> {
  const { supabase, desk } = await requireDesk();
  const label = f.get("assistant") === "ChatGPT" ? "ChatGPT" : "Claude";
  const { data, error } = await supabase.rpc("create_connector_link", { d: desk.id, link_label: label });
  if (error) return { error: error.message };
  revalidatePath("/desk/settings");
  return { token: data as string, label };
}

export async function revokeConnectorLink(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("connector_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings");
}
