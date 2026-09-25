"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnswerText } from "@/components/ask/answer-text";
import { PendingAnswer } from "@/components/ask/pending-answer";
import { useConnectors, WatchStatus } from "@/components/ask/watch-status";
import { ConfirmButton } from "@/components/confirm-button";
import { setCounselorModel } from "@/app/desk/connector-actions";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { MESSAGE_MAX } from "@/lib/bridge/listing";
import { bridgeMissing, queueRequest, REQUEST_COLS, type DeskRequest, type RequestKind } from "@/lib/bridge/requests";
import { hasWaiting, mergeRequest, removeRequest, sortThread, THREAD_LIMIT } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import { activityOn, counselors, type Connector } from "@/lib/bridge/watchers";
import { counselorChoice, EFFORTS, MODELS, type EffortId, type ModelId } from "@/lib/counselor/models";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * A conversation with the counselor through the desk, not tied to a piece: the Profile page's
 * interview and the Counselor page's chat. Each message queues a request; the counselor (or a
 * watching chat) answers it, and the answer arrives here live, streamed while it is written.
 */

const NOT_YET = "Run the latest database update to use this.";

type Choice = { model: ModelId; effort: EffortId };

/** A counselor whose model can be chosen from here (a desk with migration 20261004, a counselor from version 2 on). */
function choosable(c: Connector | undefined): c is Connector & { id: string } {
  return !!c?.id && c.counselor_model !== undefined && c.counselor_version !== undefined;
}

function Pick<T extends string>({ label, options, value, onChange }: { label: string; options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted">
      {label}
      <select
        className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface DeskThreadProps {
  deskId: string;
  /** What a message sent here is. */
  kind: Extract<RequestKind, "interview" | "chat">;
  /** Other kinds shown in the same conversation (the counselor chat shows the interview too). */
  also?: RequestKind[];
  title: string;
  intro: ReactNode;
  /** Label and placeholder of the message box. */
  inputLabel: string;
  placeholder: string;
  sendLabel: string;
  /** Shown for a message sent with no text (starting an interview). */
  startedLabel?: string;
  clearQuestion: string;
  /** Shown before the first message; `send("")` starts without text. */
  empty: (send: (text: string) => void, busy: boolean) => ReactNode;
  /** Whether the message box shows before the first message. */
  inputFirst?: boolean;
  testId: string;
  className?: string;
}

export function DeskThread(p: DeskThreadProps) {
  const { deskId, kind } = p;
  const supabase = supabaseBrowser();
  const ids = useId();
  const now = useNow(5_000);
  const { connectors, reload } = useConnectors(deskId);
  // The counselor's model and how hard it thinks, chosen right here; shown at once, saved for every question after.
  const counselor = counselors(connectors, now)[0];
  const [picked, setPicked] = useState<(Choice & { id: string }) | null>(null);
  const choice: Choice | null = choosable(counselor) ? (picked?.id === counselor.id ? picked : counselorChoice(counselor)) : null;
  const [rows, setRows] = useState<DeskRequest[] | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const shownKey = [kind, ...(p.also ?? [])].join(",");
  const shown = useMemo(() => shownKey.split(",") as RequestKind[], [shownKey]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", deskId)
      .is("piece_id", null)
      .in("kind", shown)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(THREAD_LIMIT);
    if (error) {
      setError(bridgeMissing(error) || error.code === "42703" ? NOT_YET : `Couldn't load this conversation (${error.message}).`);
      setRows((r) => r ?? []);
      return;
    }
    setRows(sortThread((data ?? []) as DeskRequest[], null, shown));
  }, [supabase, deskId, shown]);

  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) => setRows((l) => mergeRequest(l ?? [], row, null, shown)),
        onDelete: (id) => setRows((l) => (l ? removeRequest(l, id) : l)),
        onReady: () => void load(),
      }),
    [supabase, deskId, shown, load],
  );

  // A backstop for a dropped realtime connection while an answer is due.
  const waiting = hasWaiting(rows ?? []);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting, load]);

  // Keep the newest message (and an answer as it streams in) in view.
  const signature = (rows ?? []).map((r) => `${r.id}:${r.status}:${r.answer.length}`).join();
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [signature]);

  async function send(text: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await queueRequest(supabase, { deskId, pieceId: null, kind, prompt: text, model: choice?.model ?? "" });
      setRows((l) => mergeRequest(l ?? [], row, null, shown));
      setDraft("");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(bridgeMissing(err) || err.code === "23514" ? NOT_YET : `Couldn't send it (${err.message ?? "unknown error"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function choose(next: Choice) {
    if (!choosable(counselor)) return;
    const id = counselor.id;
    setPicked({ ...next, id });
    setError(null);
    try {
      await setCounselorModel(id, next.model, next.effort);
      await reload();
    } catch (e) {
      setPicked(null);
      setError(`Couldn't change the model (${(e as Error).message}).`);
    }
  }

  async function clear() {
    const { error } = await supabase.from("desk_requests").delete().eq("desk_id", deskId).is("piece_id", null).in("kind", shown);
    if (error) return setError(`Couldn't clear it (${error.message}).`);
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
    <section aria-labelledby={`${ids}-h`} className={`card flex flex-col gap-3 px-4 py-4 ${p.className ?? ""}`} data-testid={p.testId}>
      <div>
        <h2 id={`${ids}-h`} className="font-serif text-xl">
          {p.title}
        </h2>
        <div className="mt-1 text-xs text-muted">{p.intro}</div>
      </div>
      <WatchStatus connectors={connectors} now={now} />

      <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !started ? (
          p.empty((t) => void send(t), busy)
        ) : (
          <ol aria-label={p.title} aria-live="polite" className="flex flex-col gap-3">
            {list.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5" data-testid={`${p.testId}-turn`}>
                {r.prompt ? (
                  <p className="max-w-[90%] self-end rounded-md bg-accent-soft px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap">{r.prompt}</p>
                ) : (
                  <p className="self-end text-xs text-muted">{p.startedLabel ?? "You"}</p>
                )}
                {r.status === "pending" ? (
                  <PendingAnswer r={r} who="Claude" doing={activityOn(connectors, r.id, now)} />
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

      {(started || p.inputFirst) && (
        <form
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) void send(draft.trim());
          }}
        >
          <label htmlFor={`${ids}-a`} className="sr-only">
            {p.inputLabel}
          </label>
          <textarea
            id={`${ids}-a`}
            className="field min-h-20 resize-y"
            rows={3}
            value={draft}
            maxLength={MESSAGE_MAX}
            placeholder={p.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn btn-primary" disabled={busy || !draft.trim()}>
                {p.sendLabel}
              </button>
              {choice && (
                <>
                  <Pick label="Model" options={MODELS} value={choice.model} onChange={(m) => void choose({ ...choice, model: m })} />
                  <Pick label="Thinking" options={EFFORTS} value={choice.effort} onChange={(e) => void choose({ ...choice, effort: e })} />
                </>
              )}
            </span>
            {started && <ConfirmButton label="Start over" confirmLabel="Clear" question={p.clearQuestion} onConfirm={clear} />}
          </div>
        </form>
      )}
    </section>
  );
}
