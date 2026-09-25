"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import type { NoticeTab } from "@/lib/bridge/notices";
import { subscribeUnread, unreadSnapshot, unreadTabs } from "@/lib/bridge/unread";

/** The desk's top-level pages. `base` is "/desk" for the owner, "/shared/<id>" for members. */
export function DeskNav({ base, owner, deskId }: { base: string; owner: boolean; deskId?: string }) {
  const path = usePathname();
  // Tabs with a reply from Claude not looked at yet (the student's own desk only).
  const subscribe = useCallback((onChange: () => void) => (deskId ? subscribeUnread(deskId, onChange) : () => {}), [deskId]);
  const unread = unreadTabs(useSyncExternalStore(subscribe, () => (deskId ? unreadSnapshot(deskId) : "[]"), () => "[]"));
  const pages = [
    {
      href: base,
      label: "Board",
      match: (p: string) =>
        p === base || [`${base}/college/`, `${base}/progress`, `${base}/add/`].some((prefix) => p.startsWith(prefix)),
    },
    { href: `${base}/write`, label: "Write", match: (p: string) => p.startsWith(`${base}/write`) || p.startsWith(`${base}/piece/`) },
    { href: `${base}/strategy`, label: "Strategy", match: (p: string) => p.startsWith(`${base}/strategy`) },
    // Only the student's: the people they share with don't see it.
    ...(owner
      ? [
          { href: `${base}/profile`, label: "Profile", match: (p: string) => p.startsWith(`${base}/profile`) },
          { href: `${base}/counselor`, label: "Counselor", match: (p: string) => p.startsWith(`${base}/counselor`) },
        ]
      : []),
  ];
  return (
    <nav aria-label="Desk" className="flex flex-wrap items-center gap-1 rounded-lg bg-bg p-0.5 text-sm">
      {pages.map((p) => {
        const active = p.match(path);
        return (
          <Link
            key={p.label}
            href={p.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1 ${active ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          >
            {p.label}
            {owner && !active && unread.has(p.label as NoticeTab) && (
              <>
                <span aria-hidden className="ml-1.5 inline-block size-2 rounded-full bg-accent align-middle" />
                <span className="sr-only"> (new reply)</span>
              </>
            )}
          </Link>
        );
      })}
      {owner && (
        <Link
          href={`${base}/settings`}
          aria-current={path.startsWith(`${base}/settings`) ? "page" : undefined}
          className={`rounded-md px-3 py-1 ${path.startsWith(`${base}/settings`) ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          Settings
        </Link>
      )}
    </nav>
  );
}
