"use client";
import type { NoticeTab } from "./notices";

/*
 * Which desk tabs have a reply the student hasn't looked at yet, kept in this browser per desk
 * (it survives a reload, and doesn't carry over to someone else signing in here) and shared with
 * the nav through useSyncExternalStore.
 */

const key = (deskId: string) => `desk:unread:${deskId}`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

export function unreadSnapshot(deskId: string): string {
  try {
    return localStorage.getItem(key(deskId)) ?? memory.get(deskId) ?? "[]";
  } catch {
    return memory.get(deskId) ?? "[]";
  }
}

function write(deskId: string, tabs: NoticeTab[]) {
  const value = JSON.stringify(tabs);
  memory.set(deskId, value);
  try {
    localStorage.setItem(key(deskId), value);
  } catch {
    // Private mode: the in-memory copy carries the visit.
  }
  for (const l of listeners) l();
}

export function unreadTabs(snapshot: string): Set<NoticeTab> {
  try {
    const v: unknown = JSON.parse(snapshot);
    return new Set(Array.isArray(v) ? (v.filter((x) => typeof x === "string") as NoticeTab[]) : []);
  } catch {
    return new Set();
  }
}

export function markUnread(deskId: string, tab: NoticeTab) {
  const tabs = unreadTabs(unreadSnapshot(deskId));
  if (tabs.has(tab)) return;
  write(deskId, [...tabs, tab]);
}

export function clearUnread(deskId: string, tab: NoticeTab) {
  const tabs = unreadTabs(unreadSnapshot(deskId));
  if (!tabs.delete(tab)) return;
  write(deskId, [...tabs]);
}

/** Changes here and in the desk's other browser tabs. */
export function subscribeUnread(deskId: string, onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key(deskId)) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
