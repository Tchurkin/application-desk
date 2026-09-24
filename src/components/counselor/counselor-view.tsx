"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { isOutdated, useConnectors } from "@/components/ask/watch-status";
import { ConfirmButton } from "@/components/confirm-button";
import { DeskThread } from "@/components/thread/desk-thread";
import { ConnectorPermissions } from "@/app/desk/settings/connector-creator";
import { CounselorSetup, InstallSteps, isWindows } from "@/app/desk/settings/counselor-setup";
import {
  revokeConnectorLink,
  setCounselorPaused,
  setCounselorRemove,
  setCounselorSpeed,
  updateCounselorLink,
} from "@/app/desk/connector-actions";
import { subscribeDeskRequests } from "@/lib/bridge/live";
import { REQUEST_COLS, type DeskRequest, type RequestKind } from "@/lib/bridge/requests";
import { timeOf, whenLabel } from "@/lib/bridge/thread";
import { useNow } from "@/lib/bridge/use-now";
import {
  activityText,
  counselors,
  isCounselor,
  pendingReplacement,
  tookText,
  WATCH_PHRASE,
  type Connector,
  type CounselorSpeed,
} from "@/lib/bridge/watchers";
import { downloadInstaller } from "@/lib/counselor/download";
import { asEssayAccess } from "@/lib/domain/share";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * The Counselor page: talk to the counselor, see what it's doing and what it has done lately,
 * and control it (speed, pause, permissions, update, turn off).
 */

const SUGGESTIONS = [
  "What should I work on this week?",
  "Which of my essays needs the most work?",
  "Is my college list balanced?",
  "Help me plan my deadlines.",
];

export const SPEEDS: { id: CounselorSpeed; label: string; about: string }[] = [
  { id: "fast", label: "Fast", about: "Sonnet, thinking briefly. Quick answers to questions and polish." },
  { id: "balanced", label: "Balanced", about: "Sonnet, thinking it through. Good for most things." },
  { id: "thorough", label: "Thorough", about: "Opus, thinking hard. Slower; for odds, full drafts and big decisions." },
];

export function CounselorView({ deskId }: { deskId: string }) {
  const now = useNow(5_000);
  const { connectors, reload } = useConnectors(deskId, 8_000);
  const mine = counselors(connectors, now);
  const c = mine[0] ?? null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
      <DeskThread
        deskId={deskId}
        kind="chat"
        title="Talk to your counselor"
        intro={
          <>
            Ask anything: what to work on, whether your list is balanced, how to start an essay. It can also do things on your desk,
            like setting up colleges or drafting a piece, within what you allow. It remembers what you&apos;ve told it.
          </>
        }
        inputLabel="Message your counselor"
        placeholder="Message your counselor…"
        sendLabel="Send"
        clearQuestion="Clear this conversation from the page? Your counselor still remembers it."
        empty={(send, busy) => (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Start with one of these, or write your own below.</p>
            <div role="group" aria-label="Ideas" className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={busy}
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs hover:border-muted hover:text-ink"
                  onClick={() => send(q)}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        inputFirst
        testId="counselor-chat"
        className="h-[75vh] min-h-96"
      />
      <aside className="flex flex-col gap-4">
        {connectors === null ? (
          <section className="card px-4 py-4 text-sm text-muted" aria-label="Your counselor">
            Loading…
          </section>
        ) : c?.id ? (
          <CounselorCard
            key={c.id}
            counselor={{ ...c, id: c.id }}
            pending={pendingReplacement(connectors, c.id)}
            others={Math.max(0, mine.length - 1)}
            now={now}
            onChange={reload}
          />
        ) : (
          <SetupCard />
        )}
        <RecentWork deskId={deskId} now={now} />
      </aside>
    </div>
  );
}

function SetupCard() {
  return (
    <section className="card flex flex-col gap-3 px-4 py-4" aria-labelledby="counselor-setup-h" data-testid="counselor-card">
      <h2 id="counselor-setup-h" className="font-serif text-xl">
        Set up your counselor
      </h2>
      <p className="text-sm text-muted">
        One download and a double-click make Claude Code on this computer your counselor: it answers everything you ask on your desk,
        hidden, on your own Claude plan. Needs Claude Code installed and signed in once (claude.com/claude-code).
      </p>
      <CounselorSetup />
      <p className="text-xs text-muted">
        No Windows computer? Add your connector to a Claude or ChatGPT chat and say &ldquo;{WATCH_PHRASE}&rdquo;: it answers here too.
      </p>
    </section>
  );
}

function CounselorCard({
  counselor: c,
  pending,
  others,
  now,
  onChange,
}: {
  counselor: Connector & { id: string };
  /** An update downloaded for this counselor and not started yet. */
  pending: Connector | null;
  others: number;
  now: number;
  onChange: () => Promise<unknown>;
}) {
  const windows = useSyncExternalStore(
    () => () => {},
    isWindows,
    () => true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const id = c.id;
  const on = isCounselor(c, now);
  const paused = !!c.counselor_paused;
  const doing = on ? activityText(c, now) : null;
  const speed = c.counselor_speed ?? "balanced";
  const lastSeen = c.counselor_at ? whenLabel(c.counselor_at, now || timeOf(c.counselor_at)) : "";
  // A database without migration 20261002: no speed, pause or removal to offer yet.
  const legacy = c.counselor_version === undefined;
  const outdated = isOutdated(c);
  const disconnect = () => run(() => revokeConnectorLink(id));

  return (
    <section className="card flex flex-col gap-4 px-4 py-4" aria-labelledby="counselor-h" data-testid="counselor-card">
      <div>
        <h2 id="counselor-h" className="font-serif text-xl">
          Your counselor
        </h2>
        <p data-testid="counselor-state" className={`mt-1 flex items-center gap-1.5 text-sm ${on && !paused ? "text-accent" : paused ? "text-warn" : "text-muted"}`}>
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on && !paused ? "bg-accent" : paused ? "bg-warn" : "bg-line"}`} />
          {!on ? `Off · last seen ${lastSeen}` : paused ? "Paused" : doing ? `On · ${doing}` : "On · waiting for your next question"}
        </p>
        {!on && <p className="mt-1 text-xs text-muted">It runs on the computer you set it up on, and starts whenever you sign in there.</p>}
      </div>

      {pending ? (
        <div className="flex flex-col gap-2 text-sm" data-testid="counselor-update-pending">
          <p>
            Update downloaded. Run the file on the computer your counselor runs on; this one keeps answering until the new one starts,
            and the new one carries on the same conversation.
          </p>
          <InstallSteps />
          <div>
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => revokeConnectorLink(pending.id!))}>
              Cancel the update
            </button>
          </div>
        </div>
      ) : (
        outdated && (
          <div className="rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm" data-testid="counselor-update">
            <p className="mb-2">
              A faster counselor is ready: no start-up wait, answers appear as they&apos;re written, and a speed you choose here.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !windows}
              onClick={() =>
                void run(async () => {
                  const r = await updateCounselorLink(id);
                  if (r.error || !r.token) throw new Error(r.error ?? "No link was made.");
                  downloadInstaller(r.token);
                })
              }
            >
              Update the counselor
            </button>
            {!windows && <p className="mt-1 text-xs text-muted">Open this page on the computer your counselor runs on to update it.</p>}
          </div>
        )
      )}

      {!legacy && (
        <fieldset>
          <legend className="label">Speed</legend>
          <div role="radiogroup" aria-label="Speed" className="inline-flex rounded-md border border-line bg-panel p-0.5 text-sm">
            {SPEEDS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={speed === s.id}
                disabled={busy}
                onClick={() => void run(() => setCounselorSpeed(id, s.id))}
                className={`rounded px-3 py-1 ${speed === s.id ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {SPEEDS.find((s) => s.id === speed)?.about}{" "}
            {outdated ? "It takes effect once you update the counselor." : "Changes apply from the next request."}
          </p>
        </fieldset>
      )}

      {c.counselor_remove ? (
        <div className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm" data-testid="counselor-removing">
          <p>{on ? "Removing itself from your computer…" : "It will remove itself from your computer the next time that computer is on."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setCounselorRemove(id, false))}>
              Keep it
            </button>
            <ConfirmButton
              label="Just disconnect it"
              confirmLabel="Disconnect"
              question="Disconnect it now? Its files stay on that computer until you delete them."
              onConfirm={disconnect}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {!legacy && (
            <button type="button" className="btn" disabled={busy} onClick={() => void run(() => setCounselorPaused(id, !paused))}>
              {paused ? "Resume" : "Pause"}
            </button>
          )}
          {legacy || outdated ? (
            <ConfirmButton
              label="Turn off"
              confirmLabel="Turn off"
              question="Turn it off? This older counselor can't delete itself: update it first to remove it completely, or delete the folder ApplicationDesk\Counselor in your AppData\Local yourself."
              onConfirm={disconnect}
            />
          ) : (
            <ConfirmButton
              label="Remove from computer"
              confirmLabel="Remove"
              question="Remove the counselor from your computer? It stops, deletes its files and its conversation, and disconnects. You can set up a new one any time."
              onConfirm={() => run(() => setCounselorRemove(id, true))}
            />
          )}
        </div>
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      {c.essay_access !== undefined && (
        <div>
          <p className="label">What it may do</p>
          <ConnectorPermissions id={id} label="your counselor" essays={asEssayAccess(c.essay_access)} manage={c.can_manage !== false} />
        </div>
      )}
      {others > 0 && (
        <p className="text-xs text-muted">
          You have {others} more counselor{others === 1 ? "" : "s"} on other computers; see{" "}
          <Link href="/desk/settings#connect" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </p>
      )}
    </section>
  );
}

const KIND_LABEL: Record<RequestKind, string> = {
  ask: "Question",
  polish: "Polish",
  odds: "Odds",
  interview: "Interview",
  chat: "Chat",
};

const RECENT = 12;

/** The last things asked anywhere on the desk, and how long each took. */
function RecentWork({ deskId, now }: { deskId: string; now: number }) {
  const supabase = supabaseBrowser();
  const [rows, setRows] = useState<DeskRequest[] | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", deskId)
      .neq("status", "dismissed")
      .order("created_at", { ascending: false })
      .limit(RECENT);
    const list = (data ?? []) as DeskRequest[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.piece_id).filter((x): x is string => !!x))];
    if (ids.length) {
      const { data: pieces } = await supabase.from("pieces").select("id, title").in("id", ids);
      setTitles(Object.fromEntries((pieces ?? []).map((p) => [p.id as string, p.title as string])));
    }
  }, [supabase, deskId]);

  useEffect(
    () =>
      subscribeDeskRequests(supabase, deskId, {
        onRow: (row) =>
          setRows((l) => {
            if (!l) return l;
            const rest = l.filter((r) => r.id !== row.id);
            if (row.status === "dismissed") return rest;
            return [row, ...rest].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at)).slice(0, RECENT);
          }),
        onDelete: (id) => setRows((l) => (l ? l.filter((r) => r.id !== id) : l)),
        onReady: () => void load(),
      }),
    [supabase, deskId, load],
  );

  return (
    <section className="card px-4 py-4" aria-labelledby="recent-h" data-testid="recent-work">
      <h2 id="recent-h" className="mb-2 font-serif text-lg">
        Recent
      </h2>
      {rows === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing asked yet.</p>
      ) : (
        <ol className="flex flex-col gap-2 text-sm">
          {rows.map((r) => {
            const title = r.piece_id ? titles[r.piece_id] : null;
            const took = r.answered_at ? timeOf(r.answered_at) - timeOf(r.created_at) : NaN;
            return (
              <li key={r.id} className="flex flex-col">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {KIND_LABEL[r.kind] ?? r.kind}
                    {title && (
                      <>
                        {" · "}
                        <Link href={`/desk/piece/${r.piece_id}`} className="font-normal underline underline-offset-2">
                          {title}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{whenLabel(r.created_at, now || Date.parse(r.created_at))}</span>
                </span>
                <span className="text-xs text-muted">
                  {r.status === "pending"
                    ? r.answer
                      ? "Writing the answer…"
                      : r.counselor_at
                        ? "Your counselor has it"
                        : "Waiting"
                    : Number.isFinite(took)
                      ? `Answered in ${tookText(took)}`
                      : "Answered"}
                  {r.prompt && r.kind !== "polish" ? ` · “${r.prompt.length > 60 ? `${r.prompt.slice(0, 59)}…` : r.prompt}”` : ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
