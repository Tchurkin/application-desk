"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

const q = (params: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();

// ─── email and password (until the site can send codes to anyone) ───────────

export async function signIn(form: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: field(form, "email"),
    password: String(form.get("password") ?? ""),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/desk");
}

export async function signUp(form: FormData) {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: field(form, "email"),
    password: String(form.get("password") ?? ""),
    options: { data: { display_name: field(form, "name") } },
  });
  if (error) redirect(`/login?mode=signup&error=${encodeURIComponent(error.message)}`);
  if (!data.session) redirect("/login?notice=check-email");
  redirect("/desk");
}

// ─── Google ─────────────────────────────────────────────────────────────────

/** Off to Google; back at /auth/callback. */
export async function continueWithGoogle() {
  const supabase = await supabaseServer();
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });
  if (error || !data.url) redirect(`/login?${q({ error: error?.message ?? "Google sign-in isn't available right now." })}`);
  redirect(data.url);
}
