"use client";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/*
 * Which colleges are folded out into their pieces, remembered per browser. Read through
 * useSyncExternalStore so the server render (everything folded) and the first client render
 * agree, and the saved state appears right after hydration. Without storage (private mode,
 * blocked site data) it still works for the visit.
 */

const KEY = "ad:progress-open";
let memory = "[]";
const listeners = new Set<() => void>();

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function write(value: string) {
  memory = value;
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Storage is off: the in-memory copy carries the visit.
  }
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab folding a college.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function parse(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useFolds() {
  const raw = useSyncExternalStore(subscribe, read, () => "[]");
  const open = useMemo(() => new Set(parse(raw)), [raw]);
  const toggle = useCallback((key: string) => {
    const next = new Set(parse(read()));
    if (next.has(key)) next.delete(key);
    else next.add(key);
    write(JSON.stringify([...next]));
  }, []);
  /** Open exactly these (an empty list folds everything). */
  const setOpen = useCallback((keys: string[]) => write(JSON.stringify(keys)), []);
  return { open, toggle, setOpen };
}
