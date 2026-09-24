/** Small wording helpers for the Write workspace. */

/** The folded Notes drawer's one-line summary: the first line with markdown symbols dropped. */
export function notesSummary(notes: string, max = 90): string {
  const line = notes
    .split(/\r?\n/)
    .map((l) => l.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 hr ago", "2 days ago", then a date. */
export function relativeTime(at: string | number, now: number): string {
  const t = typeof at === "number" ? at : Date.parse(at);
  const ago = Math.max(0, now - t);
  if (ago < MINUTE) return "just now";
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)} min ago`;
  if (ago < DAY) return `${Math.floor(ago / HOUR)} hr ago`;
  const days = Math.floor(ago / DAY);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** A transient message for the status line: at most `max` characters, the rest in a tooltip. */
export function clip(text: string, max = 72): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
