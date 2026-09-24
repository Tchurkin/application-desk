"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fetchConnectors, isCounselor, WATCH_PHRASE, watcher, type Connector } from "@/lib/bridge/watchers";
import { supabaseBrowser } from "@/lib/supabase/client";

/** The desk's connectors, re-read every 20s while the page is visible and on return to it. */
export function useConnectors(deskId: string) {
  const supabase = supabaseBrowser();
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const reload = useCallback(() => fetchConnectors(supabase, deskId).then((c) => c && setConnectors(c)), [supabase, deskId]);

  useEffect(() => {
    let alive = true;
    void fetchConnectors(supabase, deskId).then((c) => alive && c && setConnectors(c));
    const again = () => {
      if (document.visibilityState === "visible") void reload();
    };
    const t = setInterval(again, 20_000);
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [supabase, deskId, reload]);

  return { connectors, reload };
}

/** One line: who is answering the desk right now, or how to get someone to. */
export function WatchStatus({ connectors, now }: { connectors: Connector[] | null; now: number }) {
  if (!connectors?.length) return null;
  const w = watcher(connectors, now);
  const counselor = isCounselor(w, now);
  return (
    <p role="status" data-testid="watch-status" className={`flex flex-wrap items-center gap-1.5 text-xs ${w ? "text-accent" : "text-muted"}`}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${w ? "bg-accent" : "bg-line"}`} />
      {w ? (
        counselor ? (
          <>Your counselor is on and watching your desk: ask away.</>
        ) : (
          <>{w.label} is watching your desk: ask away.</>
        )
      ) : (
        <>
          Not watching.{" "}
          <Link href="/desk/settings#counselor" className="underline underline-offset-2">
            Set up your counselor
          </Link>{" "}
          to have answers arrive on their own, or say &ldquo;{WATCH_PHRASE}&rdquo; in a Claude or ChatGPT chat.
          <button type="button" className="underline underline-offset-2" onClick={() => void navigator.clipboard?.writeText(WATCH_PHRASE)}>
            Copy
          </button>
        </>
      )}
    </p>
  );
}
