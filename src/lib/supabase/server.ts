import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { supabaseEnv } from "./env";

export async function supabaseServer() {
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy refreshes them.
        }
      },
    },
  });
}

/** The signed-in user's id and their desk, or a redirect to sign in. */
export async function requireDesk() {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: desk } = await supabase.from("desks").select("id, title").eq("owner_id", userId).maybeSingle();
  if (!desk) {
    // Someone who only joined through a share link has no desk of their own.
    const { data: shared } = await supabase.rpc("my_shared_desks");
    const first = (shared as { desk_id: string }[] | null)?.[0];
    redirect(first ? `/shared/${first.desk_id}` : "/login?error=no-desk");
  }
  return { supabase, userId, desk };
}

export type DeskRole = "owner" | "suggest" | "view";

/** A desk the caller owns or was shared, with their role on it; 404 otherwise. */
export async function requireDeskAccess(deskId: string) {
  const supabase = await supabaseServer();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");
  const { data: desk } = await supabase.from("desks").select("id, title, owner_id").eq("id", deskId).maybeSingle();
  if (!desk) notFound();
  let role: DeskRole = "owner";
  let name = "";
  if (desk.owner_id !== userId) {
    const { data: r } = await supabase.rpc("member_role", { d: deskId });
    if (r !== "view" && r !== "suggest") notFound();
    role = r;
    const { data: m } = await supabase
      .from("desk_members")
      .select("display_name")
      .eq("desk_id", deskId)
      .eq("user_id", userId)
      .maybeSingle();
    name = m?.display_name ?? "";
  }
  return { supabase, userId, desk, role, name };
}
