import { buildBoard, type College, type PieceStatus, type PieceSummary } from "@/lib/domain/colleges";
import { daysTo, urgencyOf, type Urgency } from "./due";

/*
 * What the Board's tiles and Deadlines table show, derived from the desk's colleges and pieces.
 * Pure, so it is unit-tested and the page stays a server component.
 */

/** A piece with its own due date (migration 20260928); older databases leave it out. */
type Piece = PieceSummary & { due?: string | null };

const finished = (s: PieceStatus) => s === "final" || s === "submitted";

/**
 * The piece to open for a college: its first one that is neither final nor submitted, else its
 * first one. Pieces arrive in the desk's own order (sort, then created).
 */
export function firstUnfinished<T extends PieceSummary>(pieces: T[]): T | null {
  return pieces.find((p) => !finished(p.status)) ?? pieces[0] ?? null;
}

export interface NextDeadline {
  date: string;
  days: number;
  /** The college, or "<piece> · <college>" when a piece is due before its college. */
  label: string;
}

export interface BoardStats {
  colleges: number;
  /** Colleges with every piece submitted. */
  collegesSubmitted: number;
  pieces: number;
  submitted: number;
  /** Final but not yet sent. */
  final: number;
  words: number;
  next: NextDeadline | null;
}

export function boardStats(colleges: College[], pieces: Piece[], today: string): BoardStats {
  const board = buildBoard(colleges, pieces);
  const byId = new Map(colleges.map((c) => [c.id, c]));
  const candidates: NextDeadline[] = [];
  const consider = (date: string | null | undefined, label: string) => {
    const days = daysTo(date, today);
    if (date && days !== null && days >= 0) candidates.push({ date, days, label });
  };
  // Work still owed: each college not fully submitted, and each unsent piece with a date of its own.
  for (const row of board) if (!row.submitted) consider(row.college.deadline, row.college.name);
  for (const p of pieces) {
    if (p.status === "submitted" || !p.due) continue;
    const college = p.college_id ? byId.get(p.college_id) : undefined;
    consider(p.due, college ? `${p.title} · ${college.name}` : p.title);
  }
  // Soonest first; on a tie the college (added first) wins over its own pieces.
  const next = candidates.reduce<NextDeadline | null>((best, c) => (!best || c.date < best.date ? c : best), null);

  return {
    colleges: colleges.length,
    collegesSubmitted: board.filter((r) => r.submitted).length,
    pieces: pieces.length,
    submitted: pieces.filter((p) => p.status === "submitted").length,
    final: pieces.filter((p) => p.status === "final").length,
    words: pieces.reduce((n, p) => n + (p.word_count || 0), 0),
    next,
  };
}

export interface DeadlineRow {
  college: College;
  days: number | null;
  urgency: Urgency;
  /** Pieces submitted, and all of the college's pieces. */
  done: number;
  total: number;
  words: number;
  /** Every piece submitted: the row sinks and fades. */
  submitted: boolean;
  /** The piece a click opens; null when the college has no pieces yet. */
  openPieceId: string | null;
}

/** One row per college in board order: soonest deadline first, fully submitted colleges last. */
export function deadlineRows(colleges: College[], pieces: Piece[], today: string): DeadlineRow[] {
  return buildBoard(colleges, pieces).map(({ college, pieces: ps, done, total, submitted }) => {
    const days = daysTo(college.deadline, today);
    return {
      college,
      days,
      urgency: urgencyOf(days),
      done,
      total,
      words: ps.reduce((n, p) => n + (p.word_count || 0), 0),
      submitted,
      openPieceId: firstUnfinished(ps)?.id ?? null,
    };
  });
}
