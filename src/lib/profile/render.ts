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

/**
 * How much of the profile one read_profile reply carries: well under what Claude Code takes from
 * a tool in one go (about 25,000 tokens), so a long profile comes in parts, whole sections each.
 */
export const PROFILE_PART_MAX = 60_000;

/** read_profile's reply, in parts for a long profile: part `n` (1-based) of however many. */
export function renderProfilePart(p: ProfileInfo, n = 1, max = PROFILE_PART_MAX): { text: string; part: number; parts: number } {
  const whole = renderProfile(p);
  if (whole.length <= max || p.sections.length < 2) return { text: whole, part: 1, parts: 1 };
  const intro = renderProfile({ ...p, sections: [] }).split("\n\nNo profile sections yet.")[0];
  const contents = p.sections.map((s, i) => `${i + 1}. ${s.title.trim() || "(untitled)"}`);
  const groups: ProfileSection[][] = [[]];
  let used = intro.length + contents.join("\n").length;
  for (const s of p.sections) {
    const size = s.title.length + s.body.length + 80;
    if (groups[groups.length - 1].length && used + size > max) {
      groups.push([]);
      used = 0;
    }
    groups[groups.length - 1].push(s);
    used += size;
  }
  const parts = groups.length;
  const part = Math.min(Math.max(1, Math.floor(n)), parts);
  const lines = part === 1 ? [intro, "", `## Sections (${p.sections.length}, in the student's order)`, ...contents] : [`# The student's profile, continued`];
  for (const s of groups[part - 1]) lines.push("", `### ${s.title.trim() || "(untitled)"} [section_id: ${s.id}]`, s.body.trim() || "(empty)");
  lines.push("", part < parts ? `[Part ${part} of ${parts}. Call read_profile with part: ${part + 1} for the rest.]` : `[Part ${part} of ${parts}: the end of the profile.]`);
  return { text: lines.join("\n"), part, parts };
}

/**
 * The profile as context in a request, fitted to `max` characters: whole sections from the top
 * (the student's order, so what they put first comes first), then what was left out, and when
 * something was, a pointer to read_profile.
 */
export function profileInContext(p: ProfileInfo, max: number): string {
  const whole = renderProfile(p);
  if (whole.length <= max) return whole;
  const intro = renderProfile({ ...p, sections: [] }).split("\n\nNo profile sections yet.")[0];
  const lines = [intro, "", `## Sections (${p.sections.length}, in the student's order)`];
  let used = intro.length;
  const left: string[] = [];
  for (const s of p.sections) {
    const block = `### ${s.title.trim() || "(untitled)"} [section_id: ${s.id}]\n${s.body.trim() || "(empty)"}`;
    if (!left.length && used + block.length <= max) {
      lines.push("", block);
      used += block.length + 2;
    } else left.push(s.title.trim() || "(untitled)");
  }
  lines.push(
    "",
    `[The profile is longer than fits here: ${left.length} more section${left.length === 1 ? "" : "s"} (${left.join("; ")}). ` +
      "If you haven't read the whole profile in this conversation, read it with read_profile (it comes in parts) before you answer.]",
  );
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
