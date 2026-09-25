import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Back from Google: trade the one-time code for a session, then the board. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const failed = request.nextUrl.searchParams.get("error_description");
  const url = request.nextUrl.clone();
  url.search = "";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      url.pathname = "/desk";
      return NextResponse.redirect(url);
    }
  }
  url.pathname = "/login";
  url.searchParams.set("error", failed ?? "Google sign-in didn't finish. Try again, or use a code by email.");
  return NextResponse.redirect(url);
}
