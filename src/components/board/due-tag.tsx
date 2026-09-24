import { daysLabel, daysTo, shortDate, urgencyOf, type Urgency } from "./due";

/** Text colour per urgency, for inline due dates. */
export const URGENCY_TEXT: Record<Urgency, string> = {
  none: "text-muted",
  passed: "text-muted",
  now: "text-danger font-medium",
  soon: "text-warn",
  later: "text-ink",
};

/** Pill colour per urgency, for the Deadlines table's day tags. */
const URGENCY_PILL: Record<Urgency, string> = {
  none: "bg-bg text-muted",
  passed: "bg-bg text-muted line-through",
  now: "bg-danger-soft text-danger font-medium",
  soon: "bg-warn-soft text-warn",
  later: "bg-bg text-muted",
};

/** "Nov 1" and a tag with the days left, coloured by urgency; "submitted" once it's all sent. */
export function DueTag({ date, today, submitted = false }: { date: string | null; today: string; submitted?: boolean }) {
  const days = daysTo(date, today);
  if (!date || days === null) return <span className="text-muted">No deadline</span>;
  const pill = submitted ? "bg-accent-soft text-accent" : URGENCY_PILL[urgencyOf(days)];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {shortDate(date, today)}
      <span className={`rounded-full px-1.5 py-0.5 text-xs ${pill}`}>{submitted ? "submitted" : daysLabel(days)}</span>
    </span>
  );
}
