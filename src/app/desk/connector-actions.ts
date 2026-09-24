"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { asEssayAccess, type EssayAccess } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";

export interface ConnectorState {
  token?: string;
  label?: string;
  error?: string;
}

type Supabase = Awaited<ReturnType<typeof requireDesk>>["supabase"];

/** Set what a new link may do. A database before migration 20261001 has no permissions: it does everything. */
async function applyPermissions(supabase: Supabase, id: string, essays: EssayAccess, manage: boolean) {
  const { error } = await supabase.from("connector_links").update({ essay_access: essays, can_manage: manage }).eq("id", id);
  if (error && error.code !== "42703" && error.code !== "PGRST204") throw new Error(error.message);
}

async function makeLink(label: string, essays: EssayAccess, manage: boolean): Promise<ConnectorState> {
  const { supabase, desk } = await requireDesk();
  const { data, error } = await supabase.rpc("create_connector_link", { d: desk.id, link_label: label });
  if (error) return { error: error.message };
  const token = data as string;
  // The database keeps only the token's hash.
  const { data: made } = await supabase
    .from("connector_links")
    .select("id")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .single();
  try {
    if (made) await applyPermissions(supabase, made.id, essays, manage);
  } catch (e) {
    return { error: `The link was made, but its permissions couldn't be set: ${(e as Error).message}` };
  }
  revalidatePath("/desk/settings");
  return { token, label };
}

export async function createConnectorLink(_prev: ConnectorState, f: FormData): Promise<ConnectorState> {
  const label = f.get("assistant") === "ChatGPT" ? "ChatGPT" : "Claude";
  return makeLink(label, asEssayAccess(f.get("essays")), f.get("manage") === "on");
}

/** A link for the counselor on this computer (its installer carries the token). */
export async function createCounselorLink(essays: EssayAccess, manage: boolean): Promise<ConnectorState> {
  return makeLink("Claude", asEssayAccess(essays), manage);
}

export async function setConnectorPermissions(id: string, essays: EssayAccess, manage: boolean) {
  const { supabase } = await requireDesk();
  const { error } = await supabase
    .from("connector_links")
    .update({ essay_access: asEssayAccess(essays), can_manage: !!manage })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings");
}

export async function revokeConnectorLink(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("connector_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings");
}
