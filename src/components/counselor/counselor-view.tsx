"use client";

import Link from "next/link";
import { useConnectors } from "@/components/ask/watch-status";
import { DeskThread } from "@/components/thread/desk-thread";
import { CounselorSetup } from "@/app/desk/settings/counselor-setup";
import { counselors, WATCH_PHRASE } from "@/lib/bridge/watchers";

/*
 * The Counselor page: a conversation with the counselor, with its model and how hard it thinks
 * in the message box. Setting it up, pausing and removing it are in Settings → Counselor.
 */

const SUGGESTIONS = [
  "What should I work on this week?",
  "Which of my essays needs the most work?",
  "Is my college list balanced?",
  "Help me plan my deadlines.",
];

export function CounselorView({ deskId }: { deskId: string }) {
  const { connectors } = useConnectors(deskId);
  const installed = connectors !== null && counselors(connectors).length > 0;

  return (
    <div className="flex flex-col gap-4">
      {connectors !== null && !installed && <SetupCard />}
      <DeskThread
        deskId={deskId}
        kind="chat"
        also={["interview"]}
        startedLabel="You started the profile interview"
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
    </div>
  );
}

function SetupCard() {
  return (
    <section className="card flex flex-col gap-3 px-4 py-4" aria-labelledby="counselor-setup-h" data-testid="counselor-setup-card">
      <h2 id="counselor-setup-h" className="font-serif text-xl">
        Set up your counselor
      </h2>
      <p className="text-sm text-muted">
        One download and a double-click make Claude Code on this computer your counselor: it answers everything you ask on your desk,
        hidden, on your own Claude plan. Needs Claude Code installed and signed in once (claude.com/claude-code). Choose what it may
        do in{" "}
        <Link href="/desk/settings/counselor" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
      <CounselorSetup withPermissions={false} />
      <p className="text-xs text-muted">
        No Windows computer? Add your connector to a Claude or ChatGPT chat and say &ldquo;{WATCH_PHRASE}&rdquo;: it answers here too.
      </p>
    </section>
  );
}
