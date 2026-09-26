"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";

/**
 * On the home page: open a student's desk with its name and password (set in their Settings →
 * Sharing). No account needed: a visitor gets an anonymous session for this browser.
 */
export function OpenDesk() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      aria-label="Open a desk"
      className="card flex flex-col gap-3 px-4 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const f = new FormData(e.currentTarget);
        const deskName = String(f.get("desk") ?? "").trim();
        const password = String(f.get("password") ?? "");
        const name = String(f.get("name") ?? "").trim();
        const supabase = supabaseBrowser();
        const { data: session } = await supabase.auth.getSession();
        if (!session.session) {
          const { error: e1 } = await supabase.auth.signInAnonymously({ options: { data: { display_name: name } } });
          if (e1) {
            setPending(false);
            return setError(`Couldn't start a session: ${e1.message}`);
          }
        }
        const { data, error: e2 } = await supabase.rpc("join_desk_by_name", { desk_name: deskName, pw: password, member_name: name });
        const r = data as { ok: boolean; desk_id?: string; owner?: boolean; error?: string } | null;
        if (e2 || !r?.ok) {
          setPending(false);
          return setError(r?.error ?? e2?.message ?? "Couldn't open it.");
        }
        router.push(r.owner ? "/desk" : `/shared/${r.desk_id}`);
        router.refresh();
      }}
    >
      <h2 className="font-serif text-xl">Open someone&apos;s desk</h2>
      <p className="text-sm text-muted">If a student gave you their desk&apos;s name and password.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="open-desk">
            Desk name
          </label>
          <input className="field" id="open-desk" name="desk" required maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        </div>
        <div>
          <label className="label" htmlFor="open-password">
            Password
          </label>
          <input className="field" id="open-password" name="password" type="password" required autoComplete="current-password" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="open-name">
          Your name
        </label>
        <input className="field" id="open-name" name="name" required maxLength={80} placeholder="e.g. Mom" autoComplete="given-name" />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Opening…" : "Open the desk"}
        </button>
      </div>
    </form>
  );
}
