import { labelOf, PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";
import { STAGES } from "./stages";

/*
 * The Progress board is derived, never edited as cards: one lane per college, built from the
 * desk's pieces, in the same urgency order as the Write rail. The shapes here are the subset
 * of CollegeRow / PieceRow the board needs, so loadDesk's rows fit them as they are.
 */

export interface ProgressCollege {
  id: string;
  name: string;
  deadline: string | null;
}

export interface ProgressPiece {
  id: string;
  college_id: string | null;
  title: string;
  status: PieceStatus;
  word_count: number;
  char_count?: number | null;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  sort?: number;
  created_at?: string;
  /** Its own due date (migration 20260928); otherwise the college's deadline applies. */
  due?: string | null;
}

export interface Lane {
  /** The college id, or SHARED_LANE for pieces that belong to no college. */
  key: string;
  college: ProgressCollege | null;
  name: string;
  pieces: ProgressPiece[];
  /** The soonest due date among its pieces (the college deadline when it has none yet). */
  due: string | null;
  /** Every piece submitted, and there is at least one. */
  submitted: boolean;
}

export const SHARED_LANE = "shared";
export const SHARED_NAME = "Shared pieces";

/** The date a piece is due: its own, else its college's deadline. Same rule as dueOf in queries.ts. */
export function pieceDue(piece: ProgressPiece, college: ProgressCollege | null | undefined): string | null {
  return piece.due ?? college?.deadline ?? null;
}

/** A college's pieces in the order the student set, then oldest first. */
export function comparePieces(a: ProgressPiece, b: ProgressPiece): number {
  const s = (a.sort ?? 0) - (b.sort ?? 0);
  if (s !== 0) return s;
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  return ca < cb ? -1 : ca > cb ? 1 : 0;
}

/** 0 = deadline still ahead, 1 = passed, 2 = no date. */
function dueBucket(due: string | null, today: string): number {
  if (!due) return 2;
  return due < today ? 1 : 0;
}

/**
 * Most urgent first: fully submitted colleges sink to the bottom; the rest go upcoming deadline
 * first, then passed, then undated. Ties break on the soonest due date, then the name.
 */
export function compareLanes(a: Lane, b: Lane, today: string): number {
  if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
  const ba = dueBucket(a.due, today);
  const bb = dueBucket(b.due, today);
  if (ba !== bb) return ba - bb;
  if (a.due !== b.due && a.due && b.due) return a.due < b.due ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function soonest(dates: (string | null)[]): string | null {
  let best: string | null = null;
  for (const d of dates) if (d && (!best || d < best)) best = d;
  return best;
}

/**
 * One lane per college (colleges without pieces included, so an unstarted college with a close
 * deadline still shows), plus a "Shared pieces" lane when any piece belongs to no college.
 * A piece whose college isn't loaded yet is left out until the next refresh.
 */
export function buildLanes(colleges: ProgressCollege[], pieces: ProgressPiece[], today: string): Lane[] {
  const byCollege = new Map<string, ProgressPiece[]>();
  const shared: ProgressPiece[] = [];
  const known = new Set(colleges.map((c) => c.id));
  for (const p of pieces) {
    if (!p.college_id) shared.push(p);
    else if (known.has(p.college_id)) {
      const list = byCollege.get(p.college_id) ?? [];
      list.push(p);
      byCollege.set(p.college_id, list);
    }
  }
  const lane = (key: string, college: ProgressCollege | null, name: string, ps: ProgressPiece[]): Lane => {
    const sorted = [...ps].sort(comparePieces);
    const due = sorted.length ? soonest(sorted.map((p) => pieceDue(p, college))) : (college?.deadline ?? null);
    return {
      key,
      college,
      name,
      pieces: sorted,
      due,
      submitted: sorted.length > 0 && sorted.every((p) => p.status === "submitted"),
    };
  };
  const lanes = colleges.map((c) => lane(c.id, c, c.name, byCollege.get(c.id) ?? []));
  if (shared.length) lanes.push(lane(SHARED_LANE, null, SHARED_NAME, shared));
  return lanes.sort((a, b) => compareLanes(a, b, today));
}

export interface StageGroup {
  stage: PieceStatus;
  pieces: ProgressPiece[];
}

/** A lane's pieces gathered by stage, in stage order, empty stages left out. */
export function stageGroups(pieces: ProgressPiece[]): StageGroup[] {
  return STAGES.map((stage) => ({ stage, pieces: pieces.filter((p) => p.status === stage) })).filter(
    (g) => g.pieces.length > 0,
  );
}

/** "1 Drafting, 2 Final" for screen readers, in stage order. */
export function stageSummary(pieces: ProgressPiece[]): string {
  if (!pieces.length) return "No pieces yet";
  return stageGroups(pieces)
    .map((g) => `${g.pieces.length} ${labelOf(PIECE_STATUSES, g.stage)}`)
    .join(", ");
}

/** The count on a piece's chip: "212/250w" against a word limit, "812/1000c" for characters, else "340w". */
export function countLabel(p: ProgressPiece): string {
  if (p.limit_kind === "words" && p.limit_value) return `${p.word_count}/${p.limit_value}w`;
  if (p.limit_kind === "chars" && p.limit_value && p.char_count != null) return `${p.char_count}/${p.limit_value}c`;
  return `${p.word_count}w`;
}

/** The same count in words, for the chip's accessible name. */
export function countPhrase(p: ProgressPiece): string {
  if (p.limit_kind === "words" && p.limit_value) return `${p.word_count} of ${p.limit_value} words`;
  if (p.limit_kind === "chars" && p.limit_value && p.char_count != null) {
    return `${p.char_count} of ${p.limit_value} characters`;
  }
  return `${p.word_count} word${p.word_count === 1 ? "" : "s"}`;
}

/** The piece a college's name opens: its first unfinished one, else its first. */
export function nextPiece(pieces: ProgressPiece[]): ProgressPiece | null {
  return pieces.find((p) => p.status !== "final" && p.status !== "submitted") ?? pieces[0] ?? null;
}

// ─── live changes ────────────────────────────────────────────────────────────

/** The fields the board keeps from a pieces row (realtime rows carry the whole document too). */
export function toProgressPiece(row: Record<string, unknown>): ProgressPiece | null {
  if (typeof row.id !== "string") return null;
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const kind = row.limit_kind === "chars" || row.limit_kind === "none" ? row.limit_kind : "words";
  const status = STAGES.includes(row.status as PieceStatus) ? (row.status as PieceStatus) : "not_started";
  const piece: ProgressPiece = {
    id: row.id,
    college_id: str(row.college_id),
    title: str(row.title) ?? "Untitled",
    status,
    word_count: num(row.word_count) ?? 0,
    limit_kind: kind,
    limit_value: num(row.limit_value),
  };
  if ("char_count" in row) piece.char_count = num(row.char_count);
  if ("sort" in row) piece.sort = num(row.sort) ?? 0;
  if ("created_at" in row) piece.created_at = str(row.created_at) ?? undefined;
  if ("due" in row) piece.due = str(row.due);
  return piece;
}

export type PieceChange =
  | { type: "INSERT" | "UPDATE"; row: Record<string, unknown> }
  | { type: "DELETE"; id: string };

/** The desk's pieces after one realtime change. Unrelated changes return the same array. */
export function applyPieceChange(pieces: ProgressPiece[], change: PieceChange): ProgressPiece[] {
  if (change.type === "DELETE") {
    return pieces.some((p) => p.id === change.id) ? pieces.filter((p) => p.id !== change.id) : pieces;
  }
  const next = toProgressPiece(change.row);
  if (!next) return pieces;
  const i = pieces.findIndex((p) => p.id === next.id);
  if (i < 0) return [...pieces, next];
  const out = [...pieces];
  out[i] = { ...pieces[i], ...next };
  return out;
}

/** Pieces as the student should see them: moves still being saved already applied. */
export function withPending(pieces: ProgressPiece[], pending: ReadonlyMap<string, PieceStatus>): ProgressPiece[] {
  if (pending.size === 0) return pieces;
  return pieces.map((p) => {
    const s = pending.get(p.id);
    return s && s !== p.status ? { ...p, status: s } : p;
  });
}
