import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId) {
    // Reopen the piece the student was last on.
    const { data: profile } = await supabase.from("profiles").select("last_piece_id").eq("id", userId).single();
    if (profile?.last_piece_id) {
      const { data: piece } = await supabase.from("pieces").select("id").eq("id", profile.last_piece_id).maybeSingle();
      if (piece) redirect(`/desk/piece/${piece.id}`);
    }
    redirect("/desk");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Application Desk</h1>
      <p className="mt-4 text-lg text-muted">
        Every college, every essay and short answer, in one place. Word counts against the limit, a version history back to
        the first draft, and a board that shows what&apos;s due next.
      </p>
      <p className="mt-3 text-muted">
        You write the essays. Parents can read along and suggest edits, and the optional Claude counselor can ask questions,
        but nothing lands in your text unless you accept it.
      </p>
      <div className="mt-8 flex gap-3">
        <Link className="btn btn-primary" href="/login?mode=signup">Start a desk</Link>
        <Link className="btn" href="/login">Sign in</Link>
      </div>
      <p className="mt-12 text-xs text-muted">
        Free and open source. <a className="underline" href="https://github.com/Tchurkin/application-desk">Source on GitHub</a>.
      </p>
    </main>
  );
}
