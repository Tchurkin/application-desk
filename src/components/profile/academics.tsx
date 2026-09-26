"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { updateAcademics, type AcademicsState } from "@/app/desk/profile/actions";
import { AnswerText } from "@/components/ask/answer-text";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { LengthNote } from "@/components/length-note";
import { ModelPicker, useModelChoice } from "@/components/ask/model-picker";
import { PendingAnswer } from "@/components/ask/pending-answer";
import { useConnectors, WatchStatus } from "@/components/ask/watch-status";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { MESSAGE_MAX } from "@/lib/bridge/listing";
import { bridgeMissing, queueRequest, REQUEST_COLS, type DeskRequest } from "@/lib/bridge/requests";
import { useNow } from "@/lib/bridge/use-now";
import { WATCH_PHRASE } from "@/lib/bridge/watchers";
import { ACADEMICS_MAX, type Academics } from "@/lib/profile/academics";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * The Profile page's academics: GPA, test scores, intended major, class rank and coursework,
 * typed in or read from a pasted transcript. The transcript goes to the counselor as a request;
 * its answer streams in here, and when it's done the fields show what the counselor saved.
 */

const NOT_YET = "Run the latest database update to use this.";
/** A backstop for a dropped live connection while the counselor is reading. */
const POLL_MS = 8000;

export function AcademicsCard({
  deskId,
  values,
  full,
  transcript: initial,
  transcriptReady,
}: {
  deskId: string;
  /** Null before migration 20260928. */
  values: Academics | null;
  /** The database has class rank and coursework (migration 20261006). */
  full: boolean;
  /** A transcript still being read. Its answer shows here when it arrives, and stays in the counselor chat. */
  transcript: DeskRequest | null;
  /** Transcript requests work (migration 20261006). */
  transcriptReady: boolean;
}) {
  const router = useRouter();
  const ids = useId();
  const [req, setReq] = useState<DeskRequest | null>(initial);
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useModelChoice("transcript");
  // The status last seen, so the fields refresh once, when the counselor finishes.
  const seen = useRef<string | null>(initial?.status ?? null);

  const reqId = req?.id ?? null;
  const pending = req?.status === "pending";
  // Who is answering the desk, while a transcript waits (so the card can say when nobody is).
  const { connectors } = useConnectors(deskId);
  const now = useNow(5_000);

  useEffect(() => {
    if (!reqId) return;
    const supabase = supabaseBrowser();
    let stopped = false;
    const apply = (row: DeskRequest) => {
      if (stopped) return;
      if (seen.current === "pending" && row.status !== "pending") router.refresh();
      seen.current = row.status;
      setReq(row.status === "dismissed" ? null : row);
    };
    const fetchRow = async () => {
      const { data, error: e } = await supabase.from("desk_requests").select(REQUEST_COLS).eq("id", reqId).maybeSingle();
      // A failed fetch isn't "gone": the next poll, or the live connection, tries again.
      if (stopped || e) return;
      if (data) apply(data as DeskRequest);
      else setReq(null);
    };
    const stop = subscribeDeskRequests(supabase, deskId, {
      onRow: (row) => row.id === reqId && apply(row),
      onDelete: (id) => !stopped && id === reqId && setReq(null),
      onReady: () => void fetchRow(),
    });
    const timer = setInterval(() => {
      if (seen.current === "pending" && document.visibilityState === "visible") void fetchRow();
    }, POLL_MS);
    return () => {
      stopped = true;
      stop();
      clearInterval(timer);
    };
  }, [reqId, deskId, router]);

  async function send() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const row = await queueRequest(supabaseBrowser(), { deskId, pieceId: null, kind: "transcript", prompt: text.trim(), model });
      seen.current = "pending";
      setReq(row);
      setPasting(false);
      setText("");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(bridgeMissing(err) || err.code === "23514" ? NOT_YET : `Couldn't send it (${err.message ?? "unknown error"}). Try again.`);
    } finally {
      setBusy(false);
    }
  }

  /** Withdraw a transcript that hasn't been read yet. */
  async function cancel() {
    if (!req) return;
    const { error: e } = await supabaseBrowser().from("desk_requests").update({ status: "dismissed" }).eq("id", req.id);
    if (e) setError(e.message);
    else setReq(null);
  }

  return (
    <section id="academics" aria-labelledby={`${ids}-h`} className="card flex scroll-mt-4 flex-col gap-4 px-4 py-4" data-testid="academics">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${ids}-h`} className="font-serif text-xl">
            Academics
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">
            Your grades, scores and intended major, for odds estimates on the Strategy page and help with your essays.
            {transcriptReady && " Paste your transcript and your counselor fills them in."}
          </p>
        </div>
        {transcriptReady && !pasting && !req && values && (
          <button type="button" className="btn" onClick={() => setPasting(true)}>
            Paste your transcript
          </button>
        )}
      </div>

      {pasting && (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-bg p-3">
          <label htmlFor={`${ids}-t`} className="label">
            Your transcript
          </label>
          <textarea
            id={`${ids}-t`}
            className="field min-h-40 font-mono text-xs"
            value={text}
            autoFocus
            placeholder="Copy everything from your transcript (the PDF, or your school's portal) and paste it here: courses, grades, GPA, rank."
            onChange={(e) => setText(e.target.value)}
          />
          <LengthNote length={text.length} max={MESSAGE_MAX} over="paste the part with your courses, grades, GPA and rank." />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim() || text.length > MESSAGE_MAX} onClick={() => void send()}>
              {busy ? "Sending…" : "Send to your counselor"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPasting(false);
                setText("");
              }}
            >
              Cancel
            </button>
            <ModelPicker value={model} onChange={setModel} />
          </div>
          <p className="text-xs text-muted">Your counselor saves what it finds in the fields below, where you can check and change it.</p>
        </div>
      )}

      {req && (
        <div
          data-testid="transcript-status"
          className={`rounded-md border px-3 py-2 text-sm ${pending ? "border-accent bg-accent-soft" : "border-line"}`}
        >
          <p role="status" className="mb-1 font-medium">
            {pending ? "Your transcript is with your counselor" : `${req.answered_by || "Your counselor"} read your transcript`}
          </p>
          {pending ? (
            <>
              <PendingAnswer r={req} who="your counselor" />
              <div className="mt-2">
                <WatchStatus connectors={connectors} now={now} />
              </div>
              {connectors?.length === 0 ? (
                <p className="mt-2 text-xs">
                  Nothing is connected to your desk yet.{" "}
                  <Link href="/desk/settings/counselor" className="underline underline-offset-2">
                    Set up your counselor
                  </Link>{" "}
                  or say &ldquo;{WATCH_PHRASE}&rdquo; in a Claude or ChatGPT chat, and it reads your transcript then.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  The fields below fill in when it&apos;s done. If your counselor isn&apos;t on, it reads your transcript the next time it is.
                </p>
              )}
              <button type="button" className="btn mt-2" onClick={() => void cancel()}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <AnswerText text={req.answer} />
              <p className="mt-2 text-xs text-muted">It&apos;s in your counselor chat too.</p>
              <button type="button" className="btn mt-2" onClick={() => setReq(null)}>
                Done
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {values ? (
        <AcademicsForm values={values} full={full} />
      ) : (
        <p className="text-sm text-muted">{NOT_YET}</p>
      )}
    </section>
  );
}

/*
 * Uncontrolled fields. When the page refreshes with new values (the counselor read a transcript),
 * fields the student hasn't typed in take them, and ones they have keep their text. Each field
 * also carries the value it was loaded with, so a save writes only what the student changed and
 * never undoes the counselor's work.
 */
function AcademicsForm({ values, full }: { values: Academics; full: boolean }) {
  const ids = useId();
  const [state, action, pending] = useActionState<AcademicsState, FormData>(updateAcademics, {});
  const form = useRef<HTMLFormElement>(null);
  const touched = useRef(new Set<string>());
  useEffect(() => {
    for (const k of Object.keys(values) as (keyof Academics)[]) {
      const el = form.current?.elements.namedItem(k);
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && !touched.current.has(k) && el.value !== values[k]) {
        el.value = values[k];
      }
    }
  }, [values]);
  // Saved: the fields hold what's stored again.
  useEffect(() => {
    if (state.saved) touched.current.clear();
  }, [state]);
  const field = (key: keyof Academics, label: string, placeholder: string) => (
    <div>
      <label className="label" htmlFor={`${ids}-${key}`}>
        {label}
      </label>
      <input
        className="field"
        id={`${ids}-${key}`}
        name={key}
        maxLength={ACADEMICS_MAX[key]}
        defaultValue={values[key]}
        placeholder={placeholder}
      />
      <input type="hidden" name={`was_${key}`} value={values[key]} />
    </div>
  );
  return (
    <form
      ref={form}
      action={action}
      onChange={(e) => {
        const el = e.target as EventTarget;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) touched.current.add(el.name);
      }}
      className="flex flex-col gap-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {field("gpa", "GPA", "e.g. 3.85 unweighted, 4.3 weighted")}
        {field("intended_major", "Intended major", "e.g. Mechanical engineering")}
        {field("test_scores", "Test scores", "e.g. SAT 1450 (750 math), or test-optional")}
        {full && field("class_rank", "Class rank", "e.g. 12 of 412, or not ranked")}
      </div>
      {full && (
        <div>
          <label className="label" htmlFor={`${ids}-coursework`}>
            Coursework
          </label>
          <FormattedTextarea
            className="field"
            id={`${ids}-coursework`}
            name="coursework"
            rows={6}
            maxLength={ACADEMICS_MAX.coursework}
            defaultValue={values.coursework}
            placeholder="By year: each course, its level (AP, IB, Honors) and grade. Your counselor fills this in from your transcript."
          />
          <input type="hidden" name="was_coursework" value={values.coursework} />
        </div>
      )}
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save academics"}
        </button>
        <span role="status" className="text-sm">
          {state.saved && !pending ? <span className="text-accent">Saved</span> : null}
        </span>
      </div>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
