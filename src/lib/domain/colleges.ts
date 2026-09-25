export const APP_SYSTEMS = [
  { id: "common_app", label: "Common App" },
  { id: "coalition", label: "Coalition / Scoir" },
  { id: "uc", label: "UC Application" },
  { id: "applytexas", label: "ApplyTexas" },
  { id: "ucas", label: "UCAS" },
  { id: "questbridge", label: "QuestBridge" },
  { id: "own_portal", label: "College's own application" },
  { id: "other", label: "Other" },
] as const;
export type AppSystem = (typeof APP_SYSTEMS)[number]["id"];

export const ROUNDS = [
  { id: "ED", label: "Early Decision" },
  { id: "ED2", label: "Early Decision II" },
  { id: "EA", label: "Early Action" },
  { id: "REA", label: "Restrictive Early Action" },
  { id: "RD", label: "Regular Decision" },
  { id: "rolling", label: "Rolling" },
  { id: "priority", label: "Priority" },
] as const;
export type Round = (typeof ROUNDS)[number]["id"];

export const PIECE_STATUSES = [
  { id: "not_started", label: "Not started" },
  { id: "drafting", label: "Drafting" },
  { id: "needs_review", label: "Needs review" },
  { id: "final", label: "Final" },
  { id: "submitted", label: "Submitted" },
] as const;
export type PieceStatus = (typeof PIECE_STATUSES)[number]["id"];

export type AiPolicy = "allowed" | "no_drafting";

/** The Common App lets one applicant add at most this many colleges. */
export const COMMON_APP_MAX = 20;

export interface College {
  id: string;
  name: string;
  app_system: AppSystem;
  round: Round;
  deadline: string | null; // YYYY-MM-DD
  materials_deadline: string | null;
  ai_policy: AiPolicy;
  needs_letters: boolean;
  /** When the whole application was submitted (migration 20261007); undefined before that. */
  submitted_at?: string | null;
}

export interface PieceSummary {
  id: string;
  college_id: string | null;
  title: string;
  status: PieceStatus;
  word_count: number;
}

export function labelOf<T extends { id: string; label: string }>(list: readonly T[], id: string): string {
  return list.find((x) => x.id === id)?.label ?? id;
}

export interface CommonAppCheck {
  count: number;
  over: boolean;
  /** Common App colleges that don't need recommendation letters: the easiest to move off. */
  movable: College[];
}

export function checkCommonApp(colleges: College[]): CommonAppCheck {
  const ca = colleges.filter((c) => c.app_system === "common_app");
  return {
    count: ca.length,
    over: ca.length > COMMON_APP_MAX,
    movable: ca.filter((c) => !c.needs_letters),
  };
}

/**
 * A college's application is submitted: marked so with the board's Submit button (migration
 * 20261007), or, on a database from before that, every one of its pieces is.
 */
export function collegeSubmitted(college: { submitted_at?: string | null }, pieces: { status: PieceStatus }[]): boolean {
  if (college.submitted_at !== undefined) return college.submitted_at !== null;
  return pieces.length > 0 && pieces.every((p) => p.status === "submitted");
}

export interface BoardRow {
  college: College;
  pieces: PieceSummary[];
  done: number;
  total: number;
  /** The application is submitted (on an older database: every piece is, and there is at least one). */
  submitted: boolean;
}

/**
 * Colleges in deadline order; colleges with no deadline after dated ones; fully submitted
 * colleges sink to the bottom. Ties break on name so the order is stable.
 */
export function buildBoard(colleges: College[], pieces: PieceSummary[]): BoardRow[] {
  const byCollege = new Map<string, PieceSummary[]>();
  for (const p of pieces) {
    if (!p.college_id) continue;
    const list = byCollege.get(p.college_id) ?? [];
    list.push(p);
    byCollege.set(p.college_id, list);
  }
  const rows = colleges.map((college) => {
    const ps = byCollege.get(college.id) ?? [];
    const done = ps.filter((p) => p.status === "submitted").length;
    return { college, pieces: ps, done, total: ps.length, submitted: collegeSubmitted(college, ps) };
  });
  return rows.sort((a, b) => {
    if (a.submitted !== b.submitted) return a.submitted ? 1 : -1;
    const da = a.college.deadline ?? "9999-99-99";
    const db = b.college.deadline ?? "9999-99-99";
    if (da !== db) return da < db ? -1 : 1;
    return a.college.name.localeCompare(b.college.name);
  });
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative if past. */
export function daysUntil(date: string, today: string): number {
  const a = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const b = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
