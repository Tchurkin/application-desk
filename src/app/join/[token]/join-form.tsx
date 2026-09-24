"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

export function JoinForm({ token, needsPassword }: { token: string; needsPassword: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const f = new FormData(e.currentTarget);
        const name = String(f.get("name") ?? "").trim();
        const password = String(f.get("password") ?? "");
        const supabase = supabaseBrowser();
        // No account needed: a signed-out visitor gets an anonymous session for this browser.
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          const { error: e1 } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
          if (e1) {
            setPending(false);
            return setError(`Couldn't start a session: ${e1.message}`);
          }
        }
        const { data, error: e2 } = await supabase.rpc("join_desk", { token, link_password: password, name });
        const r = data as { ok: boolean; desk_id?: string; owner?: boolean; error?: string } | null;
        if (e2 || !r?.ok) {
          setPending(false);
          return setError(r?.error ?? e2?.message ?? "Couldn't join.");
        }
        router.push(r.owner ? "/desk" : `/shared/${r.desk_id}`);
        router.refresh();
      }}
    >
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input className="field" id="name" name="name" required maxLength={80} placeholder="e.g. Mom" autoComplete="given-name" />
      </div>
      {needsPassword && (
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input className="field" id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Opening…" : "Open the desk"}
      </button>
    </form>
  );
}
