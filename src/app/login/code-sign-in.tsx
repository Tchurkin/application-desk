"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CODE_LENGTH } from "@/lib/auth/mode";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * Signing in with an emailed code. Both steps talk to Supabase from the browser, so its limits on
 * sending and checking codes count each student's own connection, not the website's server
 * (which everyone shares). The step is in the address, so a reload keeps it.
 */

const NO_DESK = "There's no desk with that email yet. Start one below, or check the spelling.";

const friendly = (message: string) =>
  /signups? not allowed|user not found/i.test(message)
    ? NO_DESK
    : /rate limit|too many|security purposes/i.test(message)
      ? "Too many codes asked for just now. Wait a minute, then try again."
      : message;

async function send(email: string, signup: boolean, name: string): Promise<string | null> {
  const { error } = await supabaseBrowser().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: signup, data: signup ? { display_name: name } : undefined },
  });
  return error ? friendly(error.message) : null;
}

/** The email (and, starting a desk, the first name): sends the code. */
export function SendCodeForm({ signup, email: initialEmail }: { signup: boolean; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim();
    setBusy(true);
    setError(null);
    const failed = await send(email, signup, String(f.get("name") ?? "").trim());
    setBusy(false);
    if (failed) return setError(failed);
    router.push(`/login?${new URLSearchParams({ step: "code", email, ...(signup ? { mode: "signup" } : {}) })}`);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {signup && (
        <div>
          <label className="label" htmlFor="name">Your first name</label>
          <input className="field" id="name" name="name" required autoComplete="given-name" />
        </div>
      )}
      <div>
        <label className="label" htmlFor="email">Email</label>
        <input className="field" id="email" name="email" type="email" required autoComplete="email" defaultValue={initialEmail} />
      </div>
      <button className="btn btn-primary mt-2" type="submit" disabled={busy}>
        {busy ? "Sending…" : "Email me a code"}
      </button>
      <p className="text-xs text-muted">No password: we email you a {CODE_LENGTH}-digit code each time you sign in.</p>
    </form>
  );
}

/** The code from the email: signs in, and can send a new one. */
export function CodeForm({ signup, email }: { signup: boolean; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\s+/g, "");
    setBusy(true);
    setError(null);
    const { error: failed } = await supabaseBrowser().auth.verifyOtp({ email, token, type: "email" });
    if (failed) {
      setBusy(false);
      return setError(
        /expired|invalid/i.test(failed.message) ? "That code didn't work. It may have expired: send a new one." : friendly(failed.message),
      );
    }
    // The session is in the cookies now, so the board loads signed in.
    router.replace("/desk");
  }

  async function resend() {
    setError(null);
    setResent(false);
    const failed = await send(email, signup, "");
    if (failed) setError(failed);
    else setResent(true);
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        We sent a {CODE_LENGTH}-digit code to <span className="font-medium text-ink">{email}</span>. It works for an hour.
      </p>
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {resent && (
        <p role="status" className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">
          A new code is on its way.
        </p>
      )}
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <div>
          <label className="label" htmlFor="code">Code</label>
          <input
            className="field text-center font-mono text-lg tracking-[0.4em]"
            id="code"
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`\\s*\\d{${CODE_LENGTH}}\\s*`}
            maxLength={CODE_LENGTH + 4}
            autoFocus
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Checking…" : signup ? "Create my desk" : "Sign in"}
        </button>
      </form>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
        <button type="button" className="text-accent underline" onClick={() => void resend()}>
          Send a new code
        </button>
        <Link className="underline" href={signup ? "/login?mode=signup" : "/login"}>
          Use a different email
        </Link>
      </div>
    </>
  );
}
