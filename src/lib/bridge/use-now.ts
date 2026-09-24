"use client";
import { useSyncExternalStore } from "react";

/*
 * A clock for "5 min ago" labels that ticks every `step` ms. The snapshot is rounded to the
 * step, so React sees one stable value between ticks; the server render gets 0.
 */

function subscribe(step: number) {
  return (onTick: () => void) => {
    const t = setInterval(onTick, step);
    return () => clearInterval(t);
  };
}

const subscribers = new Map<number, (onTick: () => void) => () => void>();

export function useNow(step = 30_000): number {
  let sub = subscribers.get(step);
  if (!sub) {
    sub = subscribe(step);
    subscribers.set(step, sub);
  }
  return useSyncExternalStore(
    sub,
    () => Math.floor(Date.now() / step) * step,
    () => 0,
  );
}
