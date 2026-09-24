"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ModelPicker, useModelChoice } from "@/components/ask/model-picker";
import { bridgeMissing, queueRequest } from "@/lib/bridge/requests";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * Starting the profile interview: it happens in the counselor chat, so the button asks the
 * counselor to begin and takes the student there, where the first question streams in.
 */

export function InterviewStart({ deskId }: { deskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useModelChoice("chat");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await queueRequest(supabaseBrowser(), { deskId, pieceId: null, kind: "interview", prompt: "", model });
      router.push("/desk/counselor");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(
        bridgeMissing(err) || err.code === "23514"
          ? "Run the latest database update to use the interview."
          : `Couldn't start it (${err.message ?? "unknown error"}). Try again.`,
      );
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="interview-h" className="card flex flex-col gap-3 px-4 py-4" data-testid="interview">
      <h2 id="interview-h" className="font-serif text-xl">
        Interview
      </h2>
      <p className="text-sm text-muted">
        Your counselor asks you one question at a time, in the chat on the Counselor page, and writes what you say into these sections in
        your words. Answer in as much detail as you like, skip anything, and stop whenever you want.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void start()}>
          {busy ? "Starting…" : "Start the interview"}
        </button>
        <ModelPicker value={model} onChange={setModel} />
      </div>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
