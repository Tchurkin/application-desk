"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { labelOf, PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";
import { PREF } from "@/lib/write/layout";
import { countLabel, groupMeta, pickCollegePiece, type RailGroup } from "@/lib/write/rail";
import { usePref, writePref } from "./hooks";

const DOT: Record<PieceStatus, string> = {
  not_started: "border border-muted bg-transparent",
  drafting: "bg-muted",
  needs_review: "bg-warn",
  final: "bg-accent",
  submitted: "bg-accent",
};

export function StatusDot({ status }: { status: PieceStatus }) {
  return <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${DOT[status]}`} />;
}

/** The piece this page opened with has had its college expanded (once, so it can be folded again). */
let expandedFor: string | null = null;

type Item = { kind: "group"; key: string; group: RailGroup } | { kind: "piece"; key: string; group: RailGroup; id: string };

/**
 * The Files tool: every college in the order it needs attention, each with its pieces. Clicking
 * a college opens its first unfinished piece; the caret (or the arrow keys) shows and hides its
 * pieces. Which colleges are expanded is remembered per browser.
 */
export function CollegeRail({
  groups,
  currentId,
  pieceHref,
  collegeHref,
  live,
}: {
  groups: RailGroup[];
  currentId: string;
  pieceHref: (id: string) => string;
  /** Where a college with no pieces yet opens (owners only). */
  collegeHref?: (id: string) => string;
  /** The open piece's count and status as the editor has them right now. */
  live: { count: string; status: PieceStatus };
}) {
  const router = useRouter();
  const stored = usePref(PREF.railOpen);
  const expanded = useMemo(() => {
    try {
      const v = JSON.parse(stored ?? "[]");
      return new Set<string>(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [stored]);
  const currentKey = groups.find((g) => g.pieces.some((p) => p.id === currentId))?.key ?? null;
  const [focusKey, setFocusKey] = useState<string>(currentId);
  const refs = useRef(new Map<string, HTMLElement>());

  const setOpen = (key: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(key);
    else next.delete(key);
    writePref(PREF.railOpen, JSON.stringify([...next]));
  };

  // Opening a piece shows it in the rail: its college expands, once.
  useEffect(() => {
    if (!currentKey || expandedFor === currentId) return;
    expandedFor = currentId;
    if (!expanded.has(currentKey)) setOpen(currentKey, true);
    // Only when the open piece changes; later folding is the student's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, currentKey]);

  const isOpen = (g: RailGroup) => g.total > 0 && expanded.has(g.key);

  const items: Item[] = groups.flatMap((g) => [
    { kind: "group" as const, key: g.key, group: g },
    ...(isOpen(g) ? g.pieces.map((p) => ({ kind: "piece" as const, key: p.id, group: g, id: p.id })) : []),
  ]);
  const focusable = items.some((i) => i.key === focusKey) ? focusKey : (items[0]?.key ?? "");

  const openGroup = (g: RailGroup) => {
    const target = pickCollegePiece(g.pieces);
    if (!target) {
      if (g.college && collegeHref) router.push(collegeHref(g.college.id));
      return;
    }
    // Already on it: the click folds or unfolds instead.
    if (target.id === currentId) setOpen(g.key, !isOpen(g));
    else router.push(pieceHref(target.id));
  };

  const activate = (item: Item) => {
    if (item.kind === "group") openGroup(item.group);
    else router.push(pieceHref(item.id));
  };

  const focus = (key: string) => {
    setFocusKey(key);
    refs.current.get(key)?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const key = (document.activeElement as HTMLElement | null)?.dataset.railKey;
    const i = items.findIndex((x) => x.key === key);
    if (i < 0) return;
    const item = items[i];
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    switch (e.key) {
      case "ArrowDown":
        handled();
        if (items[i + 1]) focus(items[i + 1].key);
        break;
      case "ArrowUp":
        handled();
        if (items[i - 1]) focus(items[i - 1].key);
        break;
      case "Home":
        handled();
        focus(items[0].key);
        break;
      case "End":
        handled();
        focus(items[items.length - 1].key);
        break;
      case "ArrowRight":
        handled();
        if (item.kind === "group" && item.group.total) {
          if (!isOpen(item.group)) setOpen(item.group.key, true);
          else if (items[i + 1]?.kind === "piece") focus(items[i + 1].key);
        }
        break;
      case "ArrowLeft":
        handled();
        if (item.kind === "piece") focus(item.group.key);
        else if (isOpen(item.group)) setOpen(item.group.key, false);
        break;
      case "Enter":
      case " ":
        handled();
        activate(item);
        break;
    }
  };

  if (!groups.length) {
    return (
      <p className="px-3 py-4 text-sm text-muted">
        No colleges yet.{" "}
        {collegeHref && (
          <Link href="/desk" className="underline">
            Add one on the board
          </Link>
        )}
      </p>
    );
  }

  return (
    <ul role="tree" aria-label="Colleges and pieces" className="py-1 text-sm" onKeyDown={onKeyDown}>
      {groups.map((g) => {
        const open = isOpen(g);
        const current = g.key === currentKey;
        const meta = groupMeta(g);
        return (
          <li
            key={g.key}
            role="treeitem"
            aria-level={1}
            aria-label={`${g.name}, ${meta}`}
            aria-expanded={g.total ? open : undefined}
            data-rail-key={g.key}
            tabIndex={focusable === g.key ? 0 : -1}
            ref={(el) => {
              if (el) refs.current.set(g.key, el);
              else refs.current.delete(g.key);
            }}
            onFocus={(e) => e.target === e.currentTarget && setFocusKey(g.key)}
            className="group/college outline-none"
          >
            <div
              className={`flex cursor-pointer items-start gap-1.5 border-l-2 py-2 pr-3 pl-1.5 hover:bg-bg group-focus-visible/college:ring-2 group-focus-visible/college:ring-accent group-focus-visible/college:ring-inset ${
                current ? "border-accent" : "border-transparent"
              } ${g.finished ? "opacity-60" : ""}`}
              onClick={() => openGroup(g)}
              title={g.total ? "Open the first piece still being worked on" : undefined}
            >
              <span
                aria-hidden
                className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] text-muted transition-transform hover:bg-line ${
                  open ? "rotate-90" : ""
                } ${g.total ? "" : "invisible"}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(g.key, !open);
                }}
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{g.name}</span>
                <span className="block truncate text-xs text-muted">{meta}</span>
                {g.total > 0 && (
                  <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${(g.done / g.total) * 100}%` }} />
                  </span>
                )}
              </span>
            </div>
            {open && (
              <ul role="group" className="pb-1">
                {g.pieces.map((p) => {
                  const here = p.id === currentId;
                  const status = here ? live.status : p.status;
                  const count = here ? live.count : countLabel({ words: p.word_count, kind: p.limit_kind, limit: p.limit_value });
                  const isVersion = !!p.variant_of && g.pieces.some((o) => o.id === p.variant_of);
                  return (
                    <li
                      key={p.id}
                      role="treeitem"
                      aria-level={2}
                      aria-label={`${p.title}, ${labelOf(PIECE_STATUSES, status)}, ${count}`}
                      aria-current={here ? "page" : undefined}
                      data-rail-key={p.id}
                      tabIndex={focusable === p.id ? 0 : -1}
                      ref={(el) => {
                        if (el) refs.current.set(p.id, el);
                        else refs.current.delete(p.id);
                      }}
                      onFocus={(e) => {
                        e.stopPropagation();
                        setFocusKey(p.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!here) router.push(pieceHref(p.id));
                      }}
                      title={p.title}
                      className={`flex cursor-pointer items-center gap-2 py-1 pr-3 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
                        isVersion ? "pl-10" : "pl-7"
                      } ${here ? "bg-accent-soft text-ink" : "text-ink/85 hover:bg-bg"}`}
                    >
                      <StatusDot status={status} />
                      <span className="min-w-0 flex-1 truncate">{p.title}</span>
                      <span className="shrink-0 font-mono text-xs text-muted">{count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
