/*
 * The student's academics, on their Profile page: typed in, or read from a pasted transcript
 * by the counselor (update_academics). Class rank and coursework came with migration 20261006.
 */

export interface Academics {
  gpa: string;
  test_scores: string;
  intended_major: string;
  class_rank: string;
  coursework: string;
}

/** How long each field may be (the connector's update_academics allows the same). */
export const ACADEMICS_MAX: Record<keyof Academics, number> = {
  gpa: 80,
  test_scores: 200,
  intended_major: 200,
  class_rank: 80,
  coursework: 4000,
};

/**
 * The academics in a profiles row, or null when the database has none yet (before migration
 * 20260928). `full` says whether it has class rank and coursework too.
 */
export function academicsOf(row: Record<string, unknown> | null | undefined): { academics: Academics; full: boolean } | null {
  if (!row || !("gpa" in row)) return null;
  const str = (k: string) => (typeof row[k] === "string" ? (row[k] as string) : "");
  return {
    academics: {
      gpa: str("gpa"),
      test_scores: str("test_scores"),
      intended_major: str("intended_major"),
      class_rank: str("class_rank"),
      coursework: str("coursework"),
    },
    full: "class_rank" in row && "coursework" in row,
  };
}

/** Whether anything has been entered. */
export const hasAcademics = (a: Academics) => Object.values(a).some((v) => v.trim() !== "");
