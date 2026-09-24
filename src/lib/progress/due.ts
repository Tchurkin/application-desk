import { daysUntil } from "@/lib/domain/colleges";

/*
 * The Due column: a short date and how long is left, colored by urgency. Dates are whole days
 * (YYYY-MM-DD), compared with the student's own calendar day, so a deadline is "today" all day
 * long and "passed" from the next morning.
 */

/** Red from this many days out. */
export const SOON_DAYS = 14;
/** Amber from this many days out. */
export const NEAR_DAYS = 45;

export type DueTone = "passed" | "soon" | "near" | "far";

export interface DueInfo {
  date: string;
  /** "Nov 1" */
  short: string;
  /** "12 days", "1 day", "today" or "passed" */
  rel: string;
  days: number;
  tone: DueTone;
}

export function dueInfo(date: string | null | undefined, today: string): DueInfo | null {
  if (!date) return null;
  const days = daysUntil(date, today);
  const short = new Date(date.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const rel = days < 0 ? "passed" : days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`;
  const tone: DueTone = days < 0 ? "passed" : days <= SOON_DAYS ? "soon" : days <= NEAR_DAYS ? "near" : "far";
  return { date, short, rel, days, tone };
}

/** The calendar day on this device (not UTC, which is already tomorrow on a US evening). */
export function localISODate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
