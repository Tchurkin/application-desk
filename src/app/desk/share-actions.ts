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

export interface SharePasswordState {
  saved?: "set" | "cleared";
  error?: string;
}

/** The one password every share link asks for the first time someone opens it; blank turns it off. */
export async function setSharePassword(_prev: SharePasswordState, f: FormData): Promise<SharePasswordState> {
  const { supabase, desk } = await requireDesk();
  const pw = f.get("clear") ? "" : String(f.get("password") ?? "");
  if (!f.get("clear") && pw.length < 6) return { error: "Use at least 6 characters for the password." };
  const { error } = await supabase.rpc("set_share_password", { d: desk.id, pw });
  if (error) {
    const missing = error.code === "PGRST202" || error.code === "42883";
    return { error: missing ? "Run the latest database update to use this." : error.message };
  }
  revalidatePath("/desk/settings", "layout");
  return { saved: pw ? "set" : "cleared" };
}
