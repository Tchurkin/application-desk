"use client";

/*
 * Small browser-state hooks for the Write workspace. Layout choices are per browser, so they
 * live in localStorage; every access is guarded, and when storage is blocked (private mode) the
 * choice still works for this visit, it just isn't remembered.
 */

import { useSyncExternalStore } from "react";

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writePref(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Kept in memory for this visit.
  }
  listeners.forEach((f) => f());
}

function subscribePrefs(fn: () => void) {
  listeners.add(fn);
  // Another tab changed a choice: follow it.
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

/** A remembered choice; null until the page is in the browser, or when nothing is stored. */
export function usePref(key: string): string | null {
  return useSyncExternalStore(
    subscribePrefs,
    () => readPref(key),
    () => null,
  );
}

/** Whether a media query matches (false while rendering on the server). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", fn);
      return () => m.removeEventListener("change", fn);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The window's width, following resizes (a typical laptop width on the server). */
export function useWindowWidth(): number {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    () => window.innerWidth,
    () => 1280,
  );
}

let now = 0;
let clock: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

/** The time, refreshed every half minute: enough for "5 min ago". */
export function useNow(): number {
  return useSyncExternalStore(
    (fn) => {
      clockListeners.add(fn);
      clock ??= setInterval(() => {
        now = Date.now();
        clockListeners.forEach((f) => f());
      }, 30_000);
      return () => {
        clockListeners.delete(fn);
        if (!clockListeners.size && clock) {
          clearInterval(clock);
          clock = null;
          now = 0;
        }
      };
    },
    () => (now ||= Date.now()),
    () => 0,
  );
}

/** Whether a key press happened while typing somewhere (then page shortcuts stay out of the way). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}
