import { dueInfo } from "@/lib/progress/due";
import { DUE_TONE } from "./tones";

/** "Nov 1" over "12 days": red within two weeks, amber within 45 days, struck through once passed. */
export function DueCell({ date, today, empty = "" }: { date: string | null; today: string; empty?: string }) {
  const d = dueInfo(date, today);
  if (!d) return <span className="text-xs text-muted">{empty}</span>;
  return (
    <span className={`flex flex-col text-right text-sm leading-tight sm:text-left ${DUE_TONE[d.tone]}`}>
      <span className="sr-only">Due </span>
      <time dateTime={d.date}>{d.short}</time>
      <span className="text-xs">{d.rel}</span>
    </span>
  );
}

/** The same, on one line, for cards. */
export function DueTag({ date, today }: { date: string | null; today: string }) {
  const d = dueInfo(date, today);
  if (!d) return null;
  return (
    <span className={`whitespace-nowrap ${DUE_TONE[d.tone]}`}>
      <span className="sr-only">Due </span>
      <time dateTime={d.date}>{d.short}</time> · {d.rel}
    </span>
  );
}
