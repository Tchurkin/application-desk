"use server";
import { revalidatePath } from "next/cache";
import { requireDesk } from "@/lib/supabase/server";

export interface CreateLinkState {
  token?: string;
  role?: "view" | "suggest";
  label?: string;
  error?: string;
}

export async function createShareLink(_prev: CreateLinkState, f: FormData): Promise<CreateLinkState> {
  const { supabase, desk } = await requireDesk();
  const role = f.get("role") === "suggest" ? "suggest" : "view";
  const label = String(f.get("label") ?? "").trim().slice(0, 80);
  const password = String(f.get("password") ?? "");
  if (password && password.length < 6) return { error: "Use at least 6 characters for the password, or leave it blank." };
  const { data, error } = await supabase.rpc("create_share_link", {
    d: desk.id,
    link_role: role,
    link_label: label,
    link_password: password,
  });
  if (error) return { error: error.message };
  revalidatePath("/desk/settings");
  return { token: data as string, role, label };
}

export async function revokeShareLink(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("share_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/desk/settings");
}
