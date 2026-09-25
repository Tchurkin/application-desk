/*
 * The student's profile as the assistant reads it: their academics and the sections on the
 * Profile page. Pure, so it is tested without a connector.
 */

export interface ProfileSection {
  id: string;
  title: string;
  body: string;
  updated_at?: string;
}

/** One reply of connector_profile(token). */
export interface ProfileInfo {
  student: {
    name?: string;
    about?: string;
    gpa?: string;
    test_scores?: string;
    intended_major?: string;
    class_rank?: string;
    coursework?: string;
  } | null;
  sections: ProfileSection[];
}

/** How much of the profile read_piece carries along; read_profile always has all of it. */
export const PROFILE_IN_PIECE_MAX = 12_000;

function academics(s: ProfileInfo["student"]): string[] {
  if (!s) return [];
  const out: string[] = [];
  if (s.gpa?.trim()) out.push(`GPA: ${s.gpa.trim()}`);
  if (s.test_scores?.trim()) out.push(`Test scores: ${s.test_scores.trim()}`);
  if (s.intended_major?.trim()) out.push(`Intended major: ${s.intended_major.trim()}`);
  if (s.class_rank?.trim()) out.push(`Class rank: ${s.class_rank.trim()}`);
  if (s.coursework?.trim()) out.push(`Coursework (from their transcript):\n${s.coursework.trim()}`);
  return out;
}

/** The whole profile, with section ids so they can be changed (read_profile). */
export function renderProfile(p: ProfileInfo): string {
  const lines = ["# The student's profile"];
  if (p.student?.name) lines.push(`Name: ${p.student.name}`);
  lines.push(...academics(p.student));
  if (p.student?.about?.trim()) lines.push("", "## About me (from Settings)", p.student.about.trim());
  if (!p.sections.length) {
    lines.push(
      "",
      "No profile sections yet. Add them with save_profile_section: for example Background, Activities, Stories, Values, Goals, Why this major.",
    );
    return lines.join("\n");
  }
  lines.push("", `## Sections (${p.sections.length}, in the student's order)`);
  for (const s of p.sections) {
    lines.push("", `### ${s.title.trim() || "(untitled)"} [section_id: ${s.id}]`, s.body.trim() || "(empty)");
  }
  return lines.join("\n");
}

/** The profile's sections as context under a piece, cut at `max` characters. */
export function profileForPiece(p: ProfileInfo, max = PROFILE_IN_PIECE_MAX): string {
  if (!p.sections.length) return "";
  const parts: string[] = [];
  let used = 0;
  for (const s of p.sections) {
    const block = `### ${s.title.trim() || "(untitled)"}\n${s.body.trim()}`;
    if (used + block.length > max) {
      parts.push("[…more in read_profile]");
      break;
    }
    parts.push(block);
    used += block.length;
  }
  return ["## The student's profile (from their Profile page)", ...parts].join("\n");
}
