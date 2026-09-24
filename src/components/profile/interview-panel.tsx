"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { AnswerText } from "@/components/ask/answer-text";
import { useConnectors, WatchStatus } from "@/components/ask/watch-status";
import { ConfirmButton } from "@/components/confirm-button";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { bridgeMissing, queueRequest, REQUEST_COLS, type DeskRequest } from "@/lib/bridge/requests";
import { hasWaiting, INTERVIEW_KINDS, mergeRequest, removeRequest, sortThread, THREAD_LIMIT } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * The interview on the Profile page. Starting it, and each answer, queues an "interview"
 * request on the desk; the counselor (or a watching chat) saves what it learned into the
 * profile's sections and answers with its next question, which arrives here live.
 */

const NOT_YET = "Run the latest database update to use the interview.";
const CHAT_PHRASE = "Interview me for my Application Desk profile";

export function InterviewPanel({ deskId }: { deskId: string }) {
  const supabase = supabaseBrowser();
  const ids = useId();
  const now = useNow();
  const { connectors } = useConnectors(deskId);
  const [rows, setRows] = useState<DeskRequest[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", deskId)
      .is("piece_id", null)
      .in("kind", INTERVIEW_KINDS)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    if (error) {
      setError(bridgeMissing(error) ? NOT_YET : `Couldn't load the interview (${error.message}).`);
      setRows((r) => r ?? []);
      return;
    }
    setRows(sortThread((data ?? []) as DeskRequest[], null, INTERVIEW_KINDS));
  }, [supabase, deskId]);

  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) => setRows((l) => mergeRequest(l ?? [], row, null, INTERVIEW_KINDS)),
        onDelete: (id) => setRows((l) => (l ? removeRequest(l, id) : l)),
        onReady: () => void load(),
      }),
    [supabase, deskId, load],
  );

  // A backstop for a dropped realtime connection while a question is due.
  const waiting = hasWaiting(rows ?? []);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting, load]);

  const signature = (rows ?? []).map((r) => `${r.id}:${r.status}`).join();
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [signature]);

  async function send(text: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await queueRequest(supabase, { deskId, pieceId: null, kind: "interview", prompt: text });
      setRows((l) => mergeRequest(l ?? [], row, null, INTERVIEW_KINDS));
      setDraft("");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(bridgeMissing(err) || err.code === "23514" ? NOT_YET : `Couldn't send it (${err.message ?? "unknown error"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    const { error } = await supabase.from("desk_requests").delete().eq("desk_id", deskId).is("piece_id", null).eq("kind", "interview");
    if (error) return setError(`Couldn't clear the interview (${error.message}).`);
    setRows([]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (draft.trim()) void send(draft.trim());
    }
  }

  const list = rows ?? [];
  const started = list.length > 0;

  return (
    <section aria-labelledby={`${ids}-h`} className="card flex max-h-[80vh] min-h-80 flex-col gap-3 px-4 py-4" data-testid="interview">
      <div>
        <h2 id={`${ids}-h`} className="font-serif text-xl">
          Interview
        </h2>
        <p className="mt-1 text-xs text-muted">
          Claude asks you one question at a time and writes what you say into your profile, in your words. Answer in as much detail
          as you like; skip anything. You can also do this in a Claude chat: say &ldquo;{CHAT_PHRASE}&rdquo;.
        </p>
      </div>
      <WatchStatus connectors={connectors} now={now} />

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !started ? (
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void send("")}>
            Start the interview
          </button>
        ) : (
          <ol aria-label="Interview" aria-live="polite" className="flex flex-col gap-3">
            {list.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5" data-testid="interview-turn">
                {r.prompt ? (
                  <p className="self-end rounded-md bg-accent-soft px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap">{r.prompt}</p>
                ) : (
                  <p className="self-end text-xs text-muted">You started the interview</p>
                )}
                {r.status === "pending" ? (
                  <p className="text-sm text-muted italic">Waiting for Claude…</p>
                ) : (
                  <div className="border-l-2 border-accent pl-2.5">
                    <p className="mb-1 font-mono text-[11px] tracking-wide text-muted uppercase">{r.answered_by || "Claude"}</p>
                    <AnswerText text={r.answer} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      {started && (
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void send(draft.trim());
          }}
        >
          <label htmlFor={`${ids}-a`} className="sr-only">
            Your answer
          </label>
          <textarea
            id={`${ids}-a`}
            className="field min-h-20 resize-y"
            rows={3}
            value={draft}
            placeholder="Your answer…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
              Send answer
            </button>
            <ConfirmButton label="Start over" confirmLabel="Clear" question="Clear this interview? Your profile stays." onConfirm={clear} />
          </div>
        </form>
      )}
    </section>
  );
}
