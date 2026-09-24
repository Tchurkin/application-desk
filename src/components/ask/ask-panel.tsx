"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import {
  assistantLabel,
  bridgeMissing,
  queueRequest,
  REQUEST_COLS,
  type Assistant,
  type DeskRequest,
} from "@/lib/bridge/requests";
import { clip, hasWaiting, mergeRequest, removeRequest, sortThread, THREAD_KINDS, THREAD_LIMIT, whenLabel } from "@/lib/bridge/thread";
import { useAssistant } from "@/lib/bridge/use-assistant";
import { useNow } from "@/lib/bridge/use-now";
import { supabaseBrowser } from "@/lib/supabase/client";
import { AnswerText } from "./answer-text";

/**
 * The Ask panel: questions and "polish this passage" requests for the connected AI, answered
 * through the connector and shown here live.
 *
 * The website can't talk to Claude or ChatGPT itself. Asking queues a request on the desk and
 * opens the student's assistant with a message to handle it; the assistant answers through the
 * connector (answer_request, and suggest_edits for rewordings) and the answer arrives here over
 * realtime, with a refresh on focus and a slow poll while anything is waiting as a backstop.
 *
 * Contract used by the Write workspace:
 *   <AskPanel deskId pieceId pieceTitle getSelection />
 * - getSelection() returns the text currently selected in the editor ("" if none), used to
 *   point the AI at a passage or to ask for rewordings of it.
 * - collegeName and aiPolicy are optional extras: the header names the college, and a college
 *   that doesn't allow AI help with drafting turns Polish off.
 */
export interface AskPanelProps {
  deskId: string;
  pieceId: string;
  pieceTitle: string;
  getSelection: () => string;
  collegeName?: string | null;
  aiPolicy?: "allowed" | "no_drafting";
}

type Phase = "loading" | "ready" | "missing" | "error";

/** Rows are held with the piece they were loaded for, so switching pieces never shows the last one's thread. */
interface Thread {
  pieceId: string;
  phase: Phase;
  rows: DeskRequest[];
}

interface Connector {
  label: string;
  last_used_at: string | null;
  /** When the assistant last checked the desk with watch_desk (migration 20260929). */
  watched_at?: string | null;
}

/** What the student says once in their open Claude/ChatGPT chat. */
export const WATCH_PHRASE = "Watch my Application Desk";
/** watch_desk checks in at least every ~45s; allow for a slow answer in between. */
const WATCH_FRESH_MS = 120_000;

/** The assistant watching the desk right now, if any. */
function watcher(connectors: Connector[] | null, now: number): Connector | null {
  return connectors?.find((c) => c.watched_at && now - Date.parse(c.watched_at) < WATCH_FRESH_MS) ?? null;
}

type Notice =
  | { kind: "queued"; watching: boolean; label: string; polish: boolean }
  | { kind: "connect" }
  | { kind: "error"; text: string };

const QUICK = ["What's the weakest part?", "How do I cut this to the limit?", "Does this answer the prompt?"];
const POLL_MS = 10_000;
const NOT_YET = "Run the latest database update to use this.";

const errText = (e: unknown) => (e as { message?: string })?.message || "unknown error";

type Fetched = { ok: true; rows: DeskRequest[] } | { ok: false; phase: "missing" | "error" };

/**
 * The piece's thread, newest 100, oldest first. If a local or live change lands while the
 * fetch is out, the result may already be stale, so it asks again (twice at most).
 */
async function fetchThread(supabase: SupabaseClient, pieceId: string, epoch: { current: number }): Promise<Fetched> {
  for (let attempt = 0; ; attempt++) {
    const started = epoch.current;
    const { data, error } = await supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("piece_id", pieceId)
      .in("kind", THREAD_KINDS)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    if (epoch.current !== started && attempt < 2) continue;
    if (error) return { ok: false, phase: bridgeMissing(error) ? "missing" : "error" };
    return { ok: true, rows: sortThread((data ?? []) as DeskRequest[], pieceId) };
  }
}

/** The desk's live connector links; null when they can't be read (then nothing is assumed). */
async function fetchConnectors(supabase: SupabaseClient, deskId: string): Promise<Connector[] | null> {
  const query = (cols: string) => supabase.from("connector_links").select(cols).eq("desk_id", deskId).is("revoked_at", null);
  let { data, error } = await query("label, last_used_at, watched_at");
  // A database before migration 20260929 has no watched_at.
  if (error?.code === "42703" || error?.code === "PGRST204") ({ data, error } = await query("label, last_used_at"));
  return error ? null : ((data ?? []) as unknown as Connector[]);
}

export function AskPanel({ deskId, pieceId, pieceTitle, getSelection, collegeName = null, aiPolicy = "allowed" }: AskPanelProps) {
  const supabase = supabaseBrowser();
  const ids = useId();
  const now = useNow();
  const [thread, setThread] = useState<Thread>({ pieceId, phase: "loading", rows: [] });
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const onlyChatGPT = !!connectors?.length && connectors.every((c) => c.label === "ChatGPT");
  const [assistant, setAssistant] = useAssistant(onlyChatGPT ? "chatgpt" : "claude");
  const label = assistantLabel(assistant);
  const [draft, setDraft] = useState("");
  const [pointed, setPointed] = useState("");
  const [ignored, setIgnored] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<(Notice & { pieceId: string }) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef(getSelection);
  // Bumped by every local or live change, so a fetch that raced one is asked again, not applied.
  const epoch = useRef(0);
  const lastLoad = useRef(0);

  useEffect(() => {
    selectionRef.current = getSelection;
  }, [getSelection]);

  const current: Thread = thread.pieceId === pieceId ? thread : { pieceId, phase: "loading", rows: [] };
  const { phase, rows } = current;
  const pointing = pointed && pointed !== ignored ? pointed : "";
  const noDrafting = aiPolicy === "no_drafting";
  const shownNotice = notice?.pieceId === pieceId ? notice : null;
  const say = (n: Notice) => setNotice({ ...n, pieceId });

  const readSelection = () => {
    try {
      return selectionRef.current().trim();
    } catch {
      return "";
    }
  };

  const apply = useCallback(
    (f: Fetched) =>
      setThread((t) =>
        f.ok ? { pieceId, phase: "ready", rows: f.rows } : { pieceId, phase: f.phase, rows: t.pieceId === pieceId ? t.rows : [] },
      ),
    [pieceId],
  );

  const load = useCallback(() => {
    lastLoad.current = Date.now();
    return fetchThread(supabase, pieceId, epoch).then(apply);
  }, [supabase, pieceId, apply]);

  const loadConnectors = useCallback(
    () => fetchConnectors(supabase, deskId).then((c) => c && setConnectors(c)),
    [supabase, deskId],
  );

  // First load, and whenever the piece changes.
  useEffect(() => {
    let alive = true;
    lastLoad.current = Date.now();
    void fetchThread(supabase, pieceId, epoch).then((f) => alive && apply(f));
    void fetchConnectors(supabase, deskId).then((c) => alive && c && setConnectors(c));
    return () => {
      alive = false;
    };
  }, [supabase, pieceId, deskId, apply]);

  // Live: the assistant's answers, and questions asked in another tab.
  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) => {
          epoch.current++;
          setThread((t) => (t.pieceId === pieceId ? { ...t, rows: mergeRequest(t.rows, row, pieceId) } : t));
        },
        onDelete: (id) => {
          epoch.current++;
          setThread((t) => (t.pieceId === pieceId ? { ...t, rows: removeRequest(t.rows, id) } : t));
        },
        onReady: () => void load(),
      }),
    [supabase, deskId, pieceId, load],
  );

  // Back from the assistant's tab (or Settings): catch up at once.
  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastLoad.current < 1000) return;
      void load();
      void loadConnectors();
    };
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [load, loadConnectors]);

  // Whether the assistant is watching: re-check every 20s while the panel is open.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void loadConnectors();
    }, 20_000);
    return () => clearInterval(t);
  }, [loadConnectors]);
  const watching = watcher(connectors, now);

  // A backstop for a dropped realtime connection while an answer is due.
  const waiting = hasWaiting(rows);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [waiting, load]);

  // The passage highlighted in the editor. Moving focus into this panel keeps it.
  useEffect(() => {
    let frame = 0;
    const read = () => {
      cancelAnimationFrame(frame);
      // After the editor has taken in the new selection.
      frame = requestAnimationFrame(() => {
        let s = "";
        try {
          s = selectionRef.current().trim();
        } catch {
          // The editor is between pieces.
        }
        if (!s) {
          if (panelRef.current?.contains(document.activeElement)) return;
          // Nothing highlighted any more: highlighting the same words again points again.
          setIgnored(null);
        }
        setPointed(s);
      });
    };
    read();
    document.addEventListener("selectionchange", read);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", read);
    };
  }, []);

  // Keep the newest exchange in view.
  const signature = rows.map((r) => `${r.id}:${r.status}`).join();
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [signature]);

  async function send(kind: "ask" | "polish") {
    if (busy) return;
    const prompt = draft.trim();
    const passage = readSelection() || pointed;
    const selection = passage && passage !== ignored ? passage : "";
    if (kind === "ask" && !prompt) {
      inputRef.current?.focus();
      return;
    }
    if (kind === "polish" && !selection) {
      say({ kind: "error", text: "Highlight a passage in your essay first, then Polish." });
      return;
    }
    const connected = connectors === null || connectors.length > 0;
    const watching = watcher(connectors, Date.now());
    setBusy(true);
    try {
      const row = await queueRequest(supabase, { deskId, pieceId, kind, prompt, selection });
      epoch.current++;
      setThread((t) => (t.pieceId === pieceId ? { ...t, phase: "ready", rows: mergeRequest(t.rows, row, pieceId) } : t));
      setDraft("");
      // Sending clears the pointer; a new highlight brings it back.
      if (selection) setIgnored(selection);
      if (!connected) say({ kind: "connect" });
      else say({ kind: "queued", watching: !!watching, label: watching?.label ?? label, polish: kind === "polish" });
    } catch (e) {
      say({
        kind: "error",
        text: bridgeMissing(e as { code?: string })
          ? NOT_YET
          : `Couldn't save your ${kind === "polish" ? "request" : "question"} (${errText(e)}), so ${label} has nothing to answer. Try again.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(r: DeskRequest) {
    epoch.current++;
    setThread((t) => (t.pieceId === pieceId ? { ...t, rows: removeRequest(t.rows, r.id) } : t));
    const { error } = await supabase.from("desk_requests").update({ status: "dismissed" }).eq("id", r.id);
    if (error) {
      epoch.current++;
      setThread((t) => (t.pieceId === pieceId ? { ...t, rows: mergeRequest(t.rows, r, pieceId) } : t));
      say({ kind: "error", text: `Couldn't dismiss it (${error.message}).` });
    }
  }

  async function clearThread() {
    const { error } = await supabase.from("desk_requests").delete().eq("piece_id", pieceId).in("kind", THREAD_KINDS);
    if (error) {
      say({ kind: "error", text: `Couldn't clear this piece's questions (${error.message}).` });
      return;
    }
    epoch.current++;
    setThread((t) => (t.pieceId === pieceId ? { ...t, rows: [] } : t));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter starts a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send("ask");
    }
  }

  const off = phase === "missing";

  return (
    <div ref={panelRef} data-testid="ask-panel" className="flex h-full min-h-0 flex-col gap-3">
      <div>
        <p className="label mb-0.5">Asking about</p>
        <p className="font-serif text-lg leading-tight break-words">
          {pieceTitle}
          {collegeName && <span className="text-sm text-muted"> · {collegeName}</span>}
        </p>
        <p className="mt-1.5 text-xs text-muted">
          This site can&apos;t talk to {label} directly. Your question waits on your desk, {label} opens in a new tab to
          answer it through your connector, and the answer shows up here.
        </p>
      </div>

      {connectors?.length === 0 && (
        <div role="note" aria-label="Set up Ask" className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-xs">
          <p className="mb-0.5 font-medium">First, connect Claude or ChatGPT to your desk</p>
          <p>
            Make a connector link in{" "}
            <Link href="/desk/settings" className="underline underline-offset-2">
              Settings
            </Link>{" "}
            and add it to Claude or ChatGPT (one time). Then, in a chat with it, say &ldquo;{WATCH_PHRASE}&rdquo;: it answers
            what you ask here, and the answers appear in this panel.
          </p>
        </div>
      )}
      {!!connectors?.length && (
        <p role="status" data-testid="watch-status" className={`flex flex-wrap items-center gap-1.5 text-xs ${watching ? "text-accent" : "text-muted"}`}>
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${watching ? "bg-accent" : "bg-line"}`} />
          {watching ? (
            <>{watching.label} is watching your desk: ask away.</>
          ) : (
            <>
              Not watching. In your Claude or ChatGPT chat, say &ldquo;{WATCH_PHRASE}&rdquo;.
              <button
                type="button"
                className="underline underline-offset-2"
                onClick={() => void navigator.clipboard?.writeText(WATCH_PHRASE)}
              >
                Copy
              </button>
            </>
          )}
        </p>
      )}

      {off && <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">{NOT_YET}</p>}

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
        {phase === "loading" && <p className="text-sm text-muted">Loading…</p>}
        {phase === "error" && (
          <p className="text-sm text-danger">
            Couldn&apos;t load this piece&apos;s questions.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => void load()}>
              Try again
            </button>
          </p>
        )}
        {phase === "ready" && rows.length === 0 && (
          <div className="text-sm text-muted">
            <p>
              Ask anything about this piece: what&apos;s weakest, whether a line earns its place, how to cut it to the limit.
              Highlight a passage in your essay first and the question is about that passage.
            </p>
            <div role="group" aria-label="Question ideas" className="mt-2 flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-muted hover:text-ink"
                  onClick={() => {
                    setDraft(q);
                    inputRef.current?.focus();
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {rows.length > 0 && (
          <ol aria-label="Questions and answers" aria-live="polite" className="flex flex-col gap-4">
            {rows.map((r) => (
              <RequestItem key={r.id} r={r} now={now} waitingFor={label} onDismiss={() => void dismiss(r)} />
            ))}
          </ol>
        )}
      </div>

      {rows.length > 0 && (
        <div className="flex justify-end">
          <ConfirmButton
            label="Clear"
            confirmLabel="Delete"
            question="Delete every question and answer on this piece?"
            onConfirm={clearThread}
          />
        </div>
      )}

      <form
        className="flex flex-col gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send("ask");
        }}
      >
        {pointing && (
          <div data-testid="pointing" className="flex items-start gap-2 rounded-md border border-warn bg-warn-soft px-2 py-1.5 text-xs">
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium">Pointing at </span>“{clip(pointing, 160)}”
            </span>
            <button
              type="button"
              className="text-muted hover:text-ink"
              aria-label="Stop pointing at this passage"
              onClick={() => setIgnored(pointing)}
            >
              ✕
            </button>
          </div>
        )}
        <label htmlFor={`${ids}-q`} className="sr-only">
          Ask about this piece
        </label>
        <textarea
          id={`${ids}-q`}
          ref={inputRef}
          className="field min-h-20 resize-y"
          rows={3}
          value={draft}
          disabled={off}
          placeholder={pointing ? "Ask about the highlighted passage…" : "Ask about this piece…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={busy || off || !draft.trim()}>
            Ask {label}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || off || noDrafting || !pointing}
            aria-describedby={`${ids}-polish`}
            onClick={() => void send("polish")}
          >
            Polish selection
          </button>
          <label className="ml-auto flex items-center gap-1 text-xs text-muted">
            Answer with
            <select
              className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
              value={assistant}
              onChange={(e) => setAssistant(e.target.value as Assistant)}
            >
              <option value="claude">Claude</option>
              <option value="chatgpt">ChatGPT</option>
            </select>
          </label>
        </div>
        <p id={`${ids}-polish`} className="text-xs text-muted">
          {noDrafting
            ? "Polish is off: this college doesn't allow AI help with drafting."
            : pointing
              ? `Polish asks ${label} for 2 or 3 rewordings of the highlighted passage. They arrive in your essay as suggestions to accept or decline.`
              : "Highlight a passage in your essay to ask about just that part, or to Polish it into suggested rewordings."}
        </p>
        <div role="status" aria-live="polite" className="text-xs">
          {shownNotice && <NoticeLine notice={shownNotice} />}
        </div>
      </form>
    </div>
  );
}

function RequestItem({ r, now, waitingFor, onDismiss }: { r: DeskRequest; now: number; waitingFor: string; onDismiss: () => void }) {
  const asked = whenLabel(r.created_at, now);
  const answered = whenLabel(r.answered_at, now);
  const question = r.prompt || (r.kind === "polish" ? "Suggest a few rewordings of this passage." : "");
  return (
    <li data-testid="request" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] tracking-wide text-muted uppercase">
          {r.kind === "polish" ? "You · Polish" : "You"}
          {asked && ` · ${asked}`}
        </span>
        <button
          type="button"
          className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline"
          aria-label={r.status === "pending" ? "Dismiss (withdraw it)" : "Dismiss"}
          onClick={onDismiss}
        >
          Dismiss
        </button>
      </div>
      {r.selection && (
        <blockquote className="border-l-2 border-warn bg-warn-soft px-2 py-1 text-xs break-words" aria-label="Highlighted passage">
          “{clip(r.selection, 280)}”
        </blockquote>
      )}
      {question && <p className="rounded-md bg-accent-soft px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap">{question}</p>}
      {r.status === "pending" ? (
        <p className="text-sm text-muted italic">Waiting for {waitingFor}…</p>
      ) : (
        <div className="border-l-2 border-accent pl-2.5">
          <p className="mb-1 font-mono text-[11px] tracking-wide text-muted uppercase">
            {r.answered_by || "Assistant"}
            {answered && ` · ${answered}`}
          </p>
          <AnswerText text={r.answer} />
          {r.kind === "polish" && (
            <p className="mt-1.5 text-xs text-muted">The rewordings are in your essay as suggestions: accept the one you like.</p>
          )}
        </div>
      )}
    </li>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const link = "font-medium underline underline-offset-2";
  switch (notice.kind) {
    case "queued":
      return notice.watching ? (
        <p className="text-muted">
          Sent to {notice.label}. {notice.polish ? "The rewordings arrive in your essay as suggestions." : "The answer appears here in a moment."}
        </p>
      ) : (
        <p className="text-warn">
          Saved. {notice.label} isn&apos;t watching your desk right now: in your {notice.label} chat, say &ldquo;{WATCH_PHRASE}&rdquo; and it
          picks this up.
        </p>
      );
    case "connect":
      return (
        <p className="text-warn">
          Saved on your desk. Connect Claude or ChatGPT in{" "}
          <Link className={link} href="/desk/settings">
            Settings
          </Link>
          , then ask it to handle your desk requests and the answer appears here.
        </p>
      );
    default:
      return <p className="text-danger">{notice.text}</p>;
  }
}
