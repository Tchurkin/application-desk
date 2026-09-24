import { daysUntil } from "@/lib/domain/colleges";

/*
 * How urgent a due date is, shared by the Board's tiles, Deadlines table and college cards so
 * they never disagree. Thresholds come from the old Deadlines table: red within three weeks,
 * amber within two months.
 */

export const NOW_WITHIN_DAYS = 21;
export const SOON_WITHIN_DAYS = 60;

export type Urgency = "none" | "passed" | "now" | "soon" | "later";

export function urgencyOf(days: number | null): Urgency {
  if (days === null) return "none";
  if (days < 0) return "passed";
  if (days <= NOW_WITHIN_DAYS) return "now";
  if (days <= SOON_WITHIN_DAYS) return "soon";
  return "later";
}

/** Days until a YYYY-MM-DD date, or null when there is none. */
export function daysTo(date: string | null | undefined, today: string): number | null {
  return date ? daysUntil(date, today) : null;
}

/** "passed", "today", "1 day", "12 days". */
export function daysLabel(days: number): string {
  if (days < 0) return "passed";
  if (days === 0) return "today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "Nov 1", with the year added when it isn't this year's ("Jan 5, 2031"). */
export function shortDate(date: string, today: string): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}
