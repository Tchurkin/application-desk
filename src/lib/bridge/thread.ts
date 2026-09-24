import type { DeskRequest, RequestKind } from "./requests";

/*
 * A piece's Ask thread: its questions and polish requests, oldest first, kept in step with
 * realtime row changes. Pure, so the merge rules are tested without a database.
 */

/** Kinds shown beside a piece. Odds requests belong to the Strategy page. */
export const THREAD_KINDS: RequestKind[] = ["ask", "polish"];

/** How many of a piece's most recent requests the panel loads. */
export const THREAD_LIMIT = 100;

/** Whether a request belongs in this piece's thread. Dismissed ones leave it. */
export function inThread(r: Pick<DeskRequest, "piece_id" | "kind" | "status">, pieceId: string): boolean {
  return r.piece_id === pieceId && THREAD_KINDS.includes(r.kind) && r.status !== "dismissed";
}

/**
 * Milliseconds for a Postgres timestamp. PostgREST and Realtime both send microseconds
 * ("2026-09-23T14:02:03.123456+00:00"), and Realtime may omit the zone; trim to what Date
 * parses the same everywhere and read a zoneless value as UTC.
 */
export function timeOf(ts: string | null | undefined): number {
  if (!ts) return NaN;
  let s = ts.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1");
  if (!/(Z|[+-]\d{2}(:?\d{2})?)$/.test(s)) s += "Z";
  return Date.parse(s);
}

function byCreated(a: DeskRequest, b: DeskRequest) {
  return timeOf(a.created_at) - timeOf(b.created_at) || a.id.localeCompare(b.id);
}

/** A thread from a fetch (any order), oldest first, without anything that doesn't belong. */
export function sortThread(rows: DeskRequest[], pieceId: string): DeskRequest[] {
  return rows.filter((r) => inThread(r, pieceId)).sort(byCreated);
}

/** Apply an inserted or updated row: add it, replace it, or drop it once dismissed or moved. */
export function mergeRequest(list: DeskRequest[], row: DeskRequest, pieceId: string): DeskRequest[] {
  const rest = list.filter((r) => r.id !== row.id);
  if (!inThread(row, pieceId)) return rest.length === list.length ? list : rest;
  return [...rest, row].sort(byCreated);
}

export function removeRequest(list: DeskRequest[], id: string): DeskRequest[] {
  const rest = list.filter((r) => r.id !== id);
  return rest.length === list.length ? list : rest;
}

/** Whether anything in the thread is still waiting for the assistant. */
export function hasWaiting(list: DeskRequest[]): boolean {
  return list.some((r) => r.status === "pending");
}

/** A passage for display on one or a few lines: whitespace collapsed, cut at `max` with "…". */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** "just now", "12 min ago", then a short date and time in the reader's locale. */
export function whenLabel(ts: string | null | undefined, now = Date.now()): string {
  const t = timeOf(ts);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((now - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const d = new Date(t);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
