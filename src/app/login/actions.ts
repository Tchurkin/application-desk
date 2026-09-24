"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export async function signIn(form: FormData) {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: field(form, "email"),
    password: String(form.get("password") ?? ""),
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/");
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
