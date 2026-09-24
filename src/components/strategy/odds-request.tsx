"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  assistantUrl,
  handoffMessage,
  queueRequest,
  REQUEST_COLS,
  setPreferredAssistant,
  type Assistant,
  type DeskRequest,
} from "@/lib/bridge/requests";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * "Estimate my odds with Claude": queue an odds request on the desk and open the assistant with
 * a message that sends it to the queue. The website can't talk to the assistant itself, so while
 * the request is pending the page polls: it refreshes as the assistant sets each college's
 * chance through the connector, and again when it answers the request.
 */

const NAME: Record<Assistant, string> = { claude: "Claude", chatgpt: "ChatGPT" };
const POLL_MS = 4000;

export const ODDS_PROMPT =
  "Estimate my admission chances for every college on my desk. Use read_strategy for my academic profile and each college's published baseline, " +
  "judge my profile against each college's admitted class (my intended major and application round included), and save each chance with " +
  "set_college_strategy, with your reasoning in chance_note. Then answer this request with a short summary.";

export function OddsRequest({
  deskId,
  assistants,
  pending: initialPending,
  last,
  bridge,
}: {
  deskId: string;
  /** Assistants with a live connector link. */
  assistants: Assistant[];
  pending: DeskRequest | null;
  last: DeskRequest | null;
  /** The desk_requests table exists (migration 20260928). */
  bridge: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<DeskRequest | null>(initialPending);
  const [queuing, setQueuing] = useState(false);
  const [chosen, setChosen] = useState<Assistant | null>(null);
  const [answered, setAnswered] = useState<DeskRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seen = useRef<string | null>(null);

  const pendingId = pending?.id ?? null;
  useEffect(() => {
    if (!pendingId) return;
    const supabase = supabaseBrowser();
    let stopped = false;
    seen.current = null;
    async function check() {
      const [req, rows] = await Promise.all([
        supabase.from("desk_requests").select(REQUEST_COLS).eq("id", pendingId).maybeSingle(),
        supabase.from("colleges").select("id, chance_percent, chance_source, fit_rank, country").eq("desk_id", deskId).order("id"),
      ]);
      if (stopped || req.error) return;
      const r = req.data as DeskRequest | null;
      // Refresh as each college changes, so the bands fill in while the assistant works.
      const print = JSON.stringify(rows.data ?? []);
      const changed = seen.current !== null && seen.current !== print;
      seen.current = print;
      if (!r || r.status !== "pending") {
        setPending(null);
        if (r?.status === "answered") setAnswered(r);
        router.refresh();
      } else if (changed) router.refresh();
    }
    void check();
    const timer = setInterval(check, POLL_MS);
    window.addEventListener("focus", check);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [pendingId, deskId, router]);

  // Coming back from the assistant's tab: show whatever it changed.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [router]);

  // The link opens the assistant's tab itself (never popup-blocked); this queues the request
  // alongside, well before the student has sent the message there.
  async function queue(a: Assistant) {
    setPreferredAssistant(a);
    setChosen(a);
    setError(null);
    setAnswered(null);
    setQueuing(true);
    try {
      setPending(await queueRequest(supabaseBrowser(), { deskId, kind: "odds", prompt: ODDS_PROMPT }));
    } catch (e) {
      setError(`Couldn't ask ${NAME[a]}: ${(e as Error).message}`);
    } finally {
      setQueuing(false);
    }
  }

  async function cancel() {
    if (!pending) return;
    const { error: e } = await supabaseBrowser().from("desk_requests").update({ status: "dismissed" }).eq("id", pending.id);
    if (e) setError(e.message);
    else setPending(null);
  }

  if (!bridge) {
    return <p className="text-sm text-muted">Run the latest database update to use this.</p>;
  }
  if (assistants.length === 0) {
    return (
      <p className="text-sm text-muted">
        Connect Claude or ChatGPT in{" "}
        <Link href="/desk/settings" className="text-accent underline">Settings</Link>, and it can estimate your odds from your
        profile. Until then the published average rate stands in, and you can set any chance yourself.
      </p>
    );
  }

  const who = chosen ?? (assistants.length === 1 ? assistants[0] : null);
  const whoName = who ? NAME[who] : "your assistant";
  const url = (a: Assistant) => assistantUrl(a, handoffMessage("odds"));

  return (
    <div className="flex flex-col gap-3 text-sm">
      {pending || queuing ? (
        <div role="status" className="rounded-md border border-accent bg-accent-soft px-3 py-2">
          <p className="font-medium">Waiting for {whoName}…</p>
          <p className="mt-1">
            Send the message in the {whoName} tab. Your odds fill in here as it sets them.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(who ? [who] : assistants).map((a) => (
              <a key={a} className="btn" href={url(a)} target="_blank" rel="noopener noreferrer">
                Open {NAME[a]} again
              </a>
            ))}
            <button type="button" className="btn" onClick={cancel} disabled={queuing}>Cancel request</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {assistants.map((a) => (
            <a
              key={a}
              className="btn btn-primary"
              href={url(a)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void queue(a)}
            >
              Estimate my odds with {NAME[a]}
            </a>
          ))}
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
      {answered ? (
        <div role="status" className="rounded-md border border-line px-3 py-2">
          <p className="font-medium">{answered.answered_by || whoName} answered</p>
          {answered.answer && <p className="mt-1 whitespace-pre-wrap">{answered.answer}</p>}
        </div>
      ) : (
        last &&
        !pending && (
          <details className="text-muted">
            <summary className="cursor-pointer">
              Last estimated
              {last.answered_at
                ? ` ${new Date(last.answered_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
                : ""}
              {last.answered_by ? ` by ${last.answered_by}` : ""}
            </summary>
            {last.answer && <p className="mt-1 whitespace-pre-wrap text-ink">{last.answer}</p>}
          </details>
        )
      )}
    </div>
  );
}
