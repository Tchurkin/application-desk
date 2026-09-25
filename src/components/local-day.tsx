"use client";
import { useSyncExternalStore } from "react";

/*
 * A moment (a timestamp) as the day it was on the student's own calendar: "Sep 24". The server
 * doesn't know the student's time zone, so it renders the UTC day and the browser takes over
 * after hydration (an evening in the US is already tomorrow in UTC).
 */

const dayOf = (at: string, zone?: string) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(zone ? { timeZone: zone } : {}) });
const still = () => () => {};

export function LocalDay({ at }: { at: string }) {
  return <>{useSyncExternalStore(still, () => dayOf(at), () => dayOf(at, "UTC"))}</>;
}
