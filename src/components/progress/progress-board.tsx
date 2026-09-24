"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PieceStatus } from "@/lib/domain/colleges";
import { localISODate } from "@/lib/progress/due";
import {
  applyPieceChange,
  buildLanes,
  withPending,
  type PieceChange,
  type ProgressCollege,
  type ProgressPiece,
} from "@/lib/progress/lanes";
import { loadProgress } from "@/lib/progress/load";
import { stageLabel } from "@/lib/progress/stages";
import { supabaseBrowser } from "@/lib/supabase/client";
import { ColumnsView } from "./columns-view";
import { LanesView, type BoardMove, type LaneContext } from "./lanes-view";
import { useFolds } from "./use-folds";

/*
 * The Progress board. It starts from what the server loaded, then keeps itself current: every
 * change to the desk's pieces streams in (a status set in the editor, or on another screen,
 * moves the chip here), and it reloads when the tab regains focus, which also covers a
 * database without live pieces. A move shows at once and is saved in the background; if the
 * save fails the piece goes back and the board says why.
 */

export type ProgressView = "lanes" | "columns";

interface Notice {
  kind: "done" | "error";
  text: string;
}

/** The student's calendar day, checked every minute so "today" rolls over at midnight. */
function subscribeClock(onChange: () => void) {
  const t = setInterval(onChange, 60_000);
  return () => clearInterval(t);
}

export function ProgressBoard({
  deskId,
  initial,
  serverToday,
  base,
  canWrite,
  collegeLinks,
  view,
  behind,
}: {
  deskId: string;
  initial: { colleges: ProgressCollege[]; pieces: ProgressPiece[] };
  /** The server's date, used until the browser's own calendar day takes over. */
  serverToday: string;
  /** "/desk" for the owner, "/shared/<id>" for people it's shared with. */
  base: string;
  canWrite: boolean;
  collegeLinks: boolean;
  view: ProgressView;
  /** The database is a migration behind: say that updates only arrive on refocus. */
  behind?: boolean;
}) {
  const [data, setData] = useState(initial);
  // Moves still being saved, shown ahead of the database.
  const [pending, setPending] = useState<ReadonlyMap<string, PieceStatus>>(() => new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const today = useSyncExternalStore(subscribeClock, () => localISODate(), () => serverToday);
  const { open, toggle, setOpen } = useFolds();
  // Bumped by every move, so a reload that started before it can't undo it.
  const epoch = useRef(0);
  // Where focus goes after a keyboard move re-creates the piece's element.
  const refocus = useRef<string | null>(null);
  // The stage each piece with a save under way should end up at.
  const saving = useRef(new Map<string, PieceStatus>());

  const refresh = useCallback(async () => {
    const started = epoch.current;
    try {
      const next = await loadProgress(supabaseBrowser(), deskId);
      if (started !== epoch.current) return;
      setData({ colleges: next.colleges, pieces: next.pieces });
    } catch {
      // Offline or signed out: keep showing what we have.
    }
  }, [deskId]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const apply = (change: PieceChange) =>
      setData((d) => {
        const pieces = applyPieceChange(d.pieces, change);
        return pieces === d.pieces ? d : { ...d, pieces };
      });
    const filter = `desk_id=eq.${deskId}`;
    // A fresh topic per mount: a remount can't pick up a channel that is still closing.
    const channel = supabase
      .channel(`progress:${deskId}:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "pieces", filter }, (p) =>
        apply({ type: "INSERT", row: p.new as Record<string, unknown> }),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "pieces", filter }, (p) =>
        apply({ type: "UPDATE", row: p.new as Record<string, unknown> }),
      )
      // Deletes carry only the id and can't be filtered by desk; ids we don't hold are ignored.
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "pieces" }, (p) => {
        const id = (p.old as { id?: unknown }).id;
        if (typeof id === "string") apply({ type: "DELETE", id });
      })
      .subscribe((status) => {
        // Connected (or reconnected): catch up on anything missed meanwhile.
        if (status === "SUBSCRIBED") void refresh();
      });

    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [deskId, refresh]);

  // After a keyboard move, keep focus on the piece even if its chip was re-created (it joined
  // or left a shared "N pieces" chip, or changed column).
  useEffect(() => {
    const token = refocus.current;
    if (!token) return;
    refocus.current = null;
    const el = document.querySelector<HTMLElement>(`[data-focus~="${CSS.escape(token)}"]`);
    if (el && el !== document.activeElement) el.focus();
  });

  const move: BoardMove = useCallback(
    (piece, to, focusToken) => {
      if (!canWrite || piece.status === to) return;
      epoch.current++;
      refocus.current = focusToken;
      setNotice(null);
      setPending((m) => new Map(m).set(piece.id, to));
      const wanted = saving.current;
      const running = wanted.has(piece.id);
      wanted.set(piece.id, to);
      if (running) return; // the save already under way picks up the new stage when it's done

      // One save at a time per piece, always of the latest stage asked for: two requests in
      // flight at once could land in either order and leave the older stage saved.
      void (async () => {
        let written: PieceStatus | null = null;
        let failure: string | null = null;
        for (let target = wanted.get(piece.id)!; target !== written; target = wanted.get(piece.id)!) {
          try {
            const { data: rows, error } = await supabaseBrowser()
              .from("pieces")
              .update({ status: target })
              .eq("id", piece.id)
              .select("id");
            // No row back means the database refused it quietly (row-level security).
            if (error || !rows?.length) failure = error ? error.message : "You may not have permission to change it.";
          } catch (e) {
            failure = e instanceof Error ? e.message : "The connection dropped.";
          }
          if (failure) break;
          written = target;
        }
        const last = wanted.get(piece.id)!;
        wanted.delete(piece.id);
        setPending((m) => {
          const next = new Map(m);
          next.delete(piece.id);
          return next;
        });
        if (written) {
          const saved = written;
          setData((d) => ({ ...d, pieces: d.pieces.map((p) => (p.id === piece.id ? { ...p, status: saved } : p)) }));
        }
        setNotice(
          failure
            ? {
                kind: "error",
                text: `Couldn't move “${piece.title}” to ${stageLabel(last)}${
                  written ? `; it's at ${stageLabel(written)}` : ", so it's back where it was"
                }. ${failure}`,
              }
            : { kind: "done", text: `Moved “${piece.title}” to ${stageLabel(last)}.` },
        );
      })();
    },
    [canWrite],
  );

  const pieces = useMemo(() => withPending(data.pieces, pending), [data.pieces, pending]);
  const lanes = useMemo(() => buildLanes(data.colleges, pieces, today), [data.colleges, pieces, today]);
  const ctx: LaneContext = { today, base, canWrite, collegeLinks, onMove: move };
  const foldable = lanes.filter((l) => l.pieces.length > 0).map((l) => l.key);
  const allOpen = foldable.length > 0 && foldable.every((k) => open.has(k));

  if (pieces.length === 0) {
    return (
      <div className="card px-4 py-6">
        <p className="font-medium">No pieces of writing yet.</p>
        <p className="mt-1 text-sm text-muted">
          {collegeLinks ? (
            <>
              Add a college and the essays it asks for on the <Link href={base} className="underline">Board</Link>, and
              each one shows up here with its stage.
            </>
          ) : (
            "When essays are added to this desk, each one shows up here with its stage."
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Progress view" className="flex items-center gap-1 rounded-lg border border-line bg-panel p-0.5 text-sm">
          {(["lanes", "columns"] as const).map((v) => (
            <Link
              key={v}
              href={`${base}/progress${v === "lanes" ? "" : "?view=columns"}`}
              aria-current={view === v ? "page" : undefined}
              className={`rounded-md px-3 py-1 ${view === v ? "bg-bg font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {v === "lanes" ? "By college" : "Columns"}
            </Link>
          ))}
        </nav>
        {view === "lanes" && foldable.length > 0 && (
          <button type="button" className="btn" onClick={() => setOpen(allOpen ? [] : foldable)}>
            {allOpen ? "Fold all" : "Show every piece"}
          </button>
        )}
      </div>

      {notice?.kind === "error" && (
        <div role="alert" className="mb-3 flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          <span>{notice.text}</span>
          <button type="button" className="shrink-0 underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
      {/* Announces each move to screen readers; also a quiet confirmation on screen. */}
      <p role="status" className="mb-2 min-h-5 text-sm text-muted">
        {notice?.kind === "done" ? notice.text : ""}
      </p>

      {view === "columns" ? (
        <ColumnsView lanes={lanes} ctx={ctx} />
      ) : (
        <LanesView lanes={lanes} open={open} onToggle={toggle} ctx={ctx} />
      )}

      {behind && (
        <p className="mt-4 text-xs text-muted">
          Run the latest database update to see changes from other screens live and to give pieces their own due
          dates. Until then this page refreshes when you come back to it.
        </p>
      )}
    </div>
  );
}
