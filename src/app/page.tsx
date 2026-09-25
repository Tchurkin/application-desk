import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId) {
    // The board is home (Write reopens the piece the student was last on).
    if (data?.claims?.is_anonymous) {
      const { data: shared } = await supabase.rpc("my_shared_desks");
      const first = (shared as { desk_id: string }[] | null)?.[0];
      if (first) redirect(`/shared/${first.desk_id}`);
    } else redirect("/desk");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <h1 className="font-serif text-4xl leading-tight sm:text-5xl">Margin</h1>
      <p className="mt-1 text-sm tracking-wide text-muted uppercase">Margin Application Desk</p>
      <p className="mt-4 text-lg text-muted">
        Every college, every essay and short answer, in one place. Word counts against the limit, a version history back to
        the first draft, and a board that shows what&apos;s due next. Bring your Google Docs over in a minute.
      </p>
      <p className="mt-3 text-muted">
        Your words sit in the middle. Everyone else works from the margin: parents read along and suggest, and Claude, as
        your counselor, answers questions, offers rewrites and helps you plan, only ever doing what you allow.
      </p>
      <div className="mt-8 flex gap-3">
        <Link className="btn btn-primary" href="/login?mode=signup">Start a desk</Link>
        <Link className="btn" href="/login">Sign in</Link>
      </div>
      <p className="mt-12 text-xs text-muted">
        Free and open source. <a className="underline" href="https://github.com/Tchurkin/margin-application-desk">Source on GitHub</a>.
      </p>
    </main>
  );
}
