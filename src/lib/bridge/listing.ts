import type { RequestKind } from "./requests";
import { timeOf } from "./thread";

/*
 * What list_desk_requests shows the assistant: each waiting request with its ids, the question
 * and the passage the student pointed at, and exactly which tools finish it. Pure, so it is
 * tested without a connector.
 */

/** One row of connector_requests(token). */
export interface PendingRequest {
  id: string;
  kind: RequestKind;
  piece_id: string | null;
  piece_title: string | null;
  prompt: string;
  selection: string;
  created_at: string;
}

/** Requests listed per call; the rest wait for the next one. */
export const LIST_MAX = 20;
/** A passage longer than this is cut in the listing (read_piece has the whole text). */
export const PASSAGE_MAX = 6000;
const PROMPT_MAX = 4000;

const WHAT: Record<RequestKind, string> = {
  ask: "a question about a piece",
  polish: "rewordings of a passage",
  odds: "admission odds for every college",
  interview: "the next question in the student's profile interview",
};

function sentAt(ts: string): string {
  const t = timeOf(ts);
  return Number.isNaN(t) ? ts : `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function cut(s: string, max: number, note: string): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n[…cut here: ${note}]`;
}

/** The passage between fences, so its exact characters (and line breaks) are unambiguous. */
function fenced(s: string): string[] {
  return ['"""', cut(s, PASSAGE_MAX, "read_piece has the whole text"), '"""'];
}

function pieceLine(r: PendingRequest): string {
  if (!r.piece_id) return "Piece: none (this request is about the whole desk)";
  return `Piece: "${r.piece_title ?? "(untitled)"}" [piece_id: ${r.piece_id}]`;
}

function askSteps(r: PendingRequest): string[] {
  const lines = [pieceLine(r), `Sent: ${sentAt(r.created_at)}`, "Question:", cut(r.prompt.trim() || "(no question typed)", PROMPT_MAX, "question cut")];
  if (r.selection.trim()) lines.push("The student highlighted this passage, so the question is about it:", ...fenced(r.selection));
  lines.push(
    `To do: call read_piece with piece_id ${r.piece_id}, then answer_request with request_id ${r.id}.`,
    "Answer directly and briefly (a few sentences), quote the exact words you mean, and don't rewrite the whole piece unless asked. " +
      "Never invent facts about the student. If the piece's college doesn't allow AI help with drafting (read_piece says so), give questions and accuracy checks, not sentences. " +
      "The answer is shown as text: paragraphs, **bold** and simple \"- \" lists work.",
  );
  return lines;
}

function polishSteps(r: PendingRequest): string[] {
  const lines = [pieceLine(r), `Sent: ${sentAt(r.created_at)}`];
  if (r.selection.trim()) lines.push("Passage to reword (use it exactly as `find`):", ...fenced(r.selection));
  else lines.push("Passage to reword: none was selected. Answer the request asking the student to highlight a passage first.");
  if (r.prompt.trim()) lines.push(`What the student wants: ${cut(r.prompt.trim(), PROMPT_MAX, "note cut")}`);
  lines.push(
    `To do: call read_piece with piece_id ${r.piece_id}. Then call suggest_edits once on that piece with 2 or 3 edits: each has find set to the passage above, ` +
      "replace_with set to a different rewording, and a short reason saying what that version does better. " +
      "Keep the student's voice, change as little as needed, add no new facts, keep about the same length (shorter if the piece is over its limit), and fit the sentence around it. " +
      "If the passage occurs more than once, extend find with a few neighbouring words (kept unchanged in replace_with) so it is unique. " +
      `Finally call answer_request with request_id ${r.id} and a one-line summary: the rewordings are waiting in the essay as suggestions for the student to accept or decline.`,
    "If the piece's college doesn't allow AI help with drafting (read_piece says so), don't reword: answer_request explaining why.",
  );
  return lines;
}

function oddsSteps(r: PendingRequest): string[] {
  const lines = [`Sent: ${sentAt(r.created_at)}`];
  if (r.prompt.trim()) lines.push(`What the student said: ${cut(r.prompt.trim(), PROMPT_MAX, "note cut")}`);
  lines.push(
    "To do: call read_strategy, then set_college_strategy for each college: chance_percent (your honest estimate for this student, " +
      "judged from their profile against the college's published admission rate and admitted scores) with your reasoning in chance_note. " +
      "Never inflate; a college admitting under about 15% is a reach for everyone. Colleges outside the US that admit on stated grades or exams get their " +
      "intl_criterion and intl_status instead of a percentage. " +
      `Then call answer_request with request_id ${r.id} and a short summary of how the list is balanced across reach, target and likely.`,
  );
  return lines;
}

function interviewSteps(r: PendingRequest): string[] {
  const reply = r.prompt.trim();
  const lines = [`Sent: ${sentAt(r.created_at)}`];
  if (reply) lines.push("The student's answer to your last question:", cut(reply, PROMPT_MAX, "answer cut"));
  else lines.push("The student just started (or restarted) the interview from their Profile page.");
  lines.push(
    "To do: call read_profile. " +
      (reply
        ? "Save what this answer tells you with save_profile_section: add to the right section or start a new one, in the student's own words, with the concrete details (moments, people, numbers, what changed). Never invent anything. "
        : "") +
      `Then call answer_request with request_id ${r.id} and your next question: one question, short and specific, that builds on what they said or opens a topic the profile is missing ` +
      "(activities and roles, a story that shows who they are, challenges, values, what they want to study and why, family and community). " +
      "When the profile is rich enough for their essays, say so and suggest what to work on next.",
  );
  return lines;
}

const STEPS: Record<RequestKind, (r: PendingRequest) => string[]> = {
  ask: askSteps,
  polish: polishSteps,
  odds: oddsSteps,
  interview: interviewSteps,
};

export function renderRequestList(rows: PendingRequest[]): string {
  if (!rows.length) {
    return (
      "Nothing is waiting from the desk right now. The student sends questions and polish requests from the Ask panel beside a piece, " +
      "odds requests from the Strategy page, and interview answers from the Profile page; if they just sent one, it may take a moment to arrive."
    );
  }
  const shown = rows.slice(0, LIST_MAX);
  const total = rows.length;
  const lines = [
    `${total} request${total === 1 ? "" : "s"} waiting from the student's desk, oldest first. ` +
      "Work through each one and close it with answer_request: the answer appears on their desk right away.",
  ];
  if (total > shown.length) lines.push(`Showing the first ${shown.length}; call list_desk_requests again after answering these.`);
  shown.forEach((r, i) => {
    lines.push("", `## ${i + 1}. ${WHAT[r.kind] ?? r.kind} [request_id: ${r.id}] (kind: ${r.kind})`, ...(STEPS[r.kind] ?? askSteps)(r));
  });
  return lines.join("\n");
}
