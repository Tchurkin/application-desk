import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { JoinForm } from "./join-form";

export const metadata = { robots: { index: false }, referrer: "no-referrer" as const };

export default async function JoinPage(props: PageProps<"/join/[token]">) {
  const { token } = await props.params;
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("link_info", { token });
  const info = data as { valid: boolean; role?: "view" | "suggest" | "edit"; needs_password?: boolean; desk_title?: string } | null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-sm text-muted">Application Desk</Link>
      {!info?.valid ? (
        <>
          <h1 className="mb-3 font-serif text-3xl">This link doesn&apos;t work</h1>
          <p className="text-muted">It may have been revoked. Ask the person who sent it for a new one.</p>
        </>
      ) : (
        <>
          <h1 className="mb-2 font-serif text-3xl">{info.desk_title}</h1>
          <p className="mb-6 text-muted">
            You&apos;ve been invited to {info.role === "edit" ? "read and edit" : info.role === "suggest" ? "read and suggest edits to" : "read"}{" "}
            these college essays.
            {info.role === "suggest" && " Your edits show as suggestions; nothing changes unless the writer accepts it."}
            {info.role === "edit" && " You can change the text directly, or switch to Suggesting so the writer decides."}
          </p>
          <JoinForm token={token} needsPassword={!!info.needs_password} />
        </>
      )}
    </main>
  );
}
