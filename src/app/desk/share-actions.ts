"use server";
import { revalidatePath } from "next/cache";
import { asShareRole, type ShareRole } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";

export interface CreateLinkState {
  token?: string;
  role?: ShareRole;
  label?: string;
  error?: string;
}

export async function createShareLink(_prev: CreateLinkState, f: FormData): Promise<CreateLinkState> {
  const { supabase, desk } = await requireDesk();
  const role = asShareRole(f.get("role"));
  const label = String(f.get("label") ?? "").trim().slice(0, 80);
  // The password is the desk's own, for every link (setSharePassword).
  const { data, error } = await supabase.rpc("create_share_link", {
    d: desk.id,
    link_role: role,
    link_label: label,
    link_password: "",
  });
  if (error) return { error: error.message };
  revalidatePath("/desk/settings", "layout");
  return { token: data as string, role, label };
}

/** Change what everyone who joined through a link can do. */
export async function setShareRole(id: string, role: ShareRole) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("share_links").update({ role: asShareRole(role) }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings", "layout");
}

export async function revokeShareLink(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings", "layout");
}

export interface DeskSharingState {
  saved?: boolean;
  error?: string;
}

/** Sharing by desk name and password: turn it on, or change the name, password (blank keeps it) or what people may do. */
export async function setDeskSharing(_prev: DeskSharingState, f: FormData): Promise<DeskSharingState> {
  const { supabase, desk } = await requireDesk();
  const name = String(f.get("name") ?? "").trim().toLowerCase();
  const pw = String(f.get("password") ?? "");
  const { data, error } = await supabase.rpc("set_desk_sharing", { d: desk.id, desk_name: name, pw: pw || null, r: asShareRole(f.get("role")) });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    return { error: missing ? "Run the latest database update (supabase/setup.sql) to use this." : error.message };
  }
  const r = data as { ok: boolean; error?: string } | null;
  if (!r?.ok) return { error: r?.error ?? "Couldn't save it." };
  revalidatePath("/desk/settings", "layout");
  return { saved: true };
}

/** Turn it off: the password goes, and everyone who came in with it loses access. */
export async function stopDeskSharing() {
  const { supabase, desk } = await requireDesk();
  const { error } = await supabase.rpc("stop_desk_sharing", { d: desk.id });
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings", "layout");
}

/** Take one person off the desk (they can come back only with the password, or a link). */
export async function removeMember(userId: string) {
  const { supabase, desk } = await requireDesk();
  const { error } = await supabase.from("desk_members").delete().eq("desk_id", desk.id).eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings", "layout");
}
