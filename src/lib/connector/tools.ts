import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { APP_SYSTEMS, labelOf, PIECE_STATUSES, ROUNDS } from "@/lib/domain/colleges";
import { countChars, countWords } from "@/lib/domain/count";
import { anchorEdit, docFromRows, flatten, type AnchoredRow } from "@/lib/suggest/anchor-text";
import { supabaseEnv } from "@/lib/supabase/env";

/*
 * The Application Desk connector: what Claude or ChatGPT can do on a student's desk.
 * Everything goes through database functions keyed by the connector token; the only thing
 * it can write is suggestions.
 */

export const INSTRUCTIONS = `You are connected to a high school student's Application Desk: their college list and the college essays and short answers they are writing. Act as a thoughtful college counselor.

These are the rules of the product, not preferences:
1. The student writes the essay. Never write an essay, or whole paragraphs, for the student to paste. To propose wording, use suggest_edits: each edit appears on the student's desk as a suggestion they accept or decline, marked as AI.
2. Respect each college's AI policy. When read_piece says a college does not allow AI drafting help, do not propose wording or write sentences for that piece, in chat or through tools. You may still ask questions, point out what is unclear, and check facts and requirements.
3. Never invent facts. Do not add events, roles, feelings, outcomes, numbers or names the student has not stated in their writing, notes or profile. If an improvement needs a fact you don't have, ask the student for it.
4. Keep the student's voice. Prefer the smallest edit that fixes the problem, and give a short reason for each.
5. Mind the word or character limit shown by read_piece.

Start with list_my_desk to see the colleges and pieces, then read_piece before commenting on or editing a piece.`;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

export function validToken(token: string) {
  return TOKEN_RE.test(token);
}

function db(): SupabaseClient {
  const { url, key } = supabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Text = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string): Text => ({ content: [{ type: "text", text: t }] });
const fail = (t: string): Text => ({ content: [{ type: "text", text: t }], isError: true });

interface DeskInfo {
  desk_title: string;
  student: { name: string; about: string } | null;
  colleges: {
    id: string;
    name: string;
    app_system: string;
    round: string;
    deadline: string | null;
    materials_deadline: string | null;
    ai_policy: "allowed" | "no_drafting";
  }[];
  pieces: {
    id: string;
    college_id: string | null;
    title: string;
    status: string;
    word_count: number;
    limit_kind: "words" | "chars" | "none";
    limit_value: number | null;
  }[];
}

interface PieceInfo {
  id: string;
  title: string;
  prompt: string;
  status: string;
  notes: string;
  limit_kind: "words" | "chars" | "none";
  limit_value: number | null;
  doc_state: string;
  updates: string[];
  college: { id: string; name: string; ai_policy: string; deadline: string | null; research: string } | null;
  other_pieces: { id: string; title: string; prompt: string; text: string; status: string }[];
  open_suggestions: { author: string; source: string; kind: string; quote: string; body: string; note: string }[];
  student: { name: string; about: string } | null;
}

function limitLine(kind: string, value: number | null) {
  if (kind === "none" || !value) return "no limit";
  return `${value} ${kind === "chars" ? "characters" : "words"}`;
}

export function renderDesk(d: DeskInfo): string {
  const lines = [`# ${d.desk_title}`];
  if (d.student?.name) lines.push(`Student: ${d.student.name}`);
  if (d.student?.about) lines.push(`About the student (in their words): ${d.student.about}`);
  const piecesFor = (id: string | null) => d.pieces.filter((p) => p.college_id === id);
  const pieceLine = (p: DeskInfo["pieces"][number]) =>
    `  - ${p.title} [piece_id: ${p.id}] ${labelOf(PIECE_STATUSES, p.status)}, ${p.word_count} words, limit ${limitLine(p.limit_kind, p.limit_value)}`;
  lines.push("", "## Colleges (by deadline)");
  if (!d.colleges.length) lines.push("None yet.");
  for (const c of d.colleges) {
    lines.push(
      `- ${c.name} [college_id: ${c.id}] ${labelOf(ROUNDS, c.round)}, ${labelOf(APP_SYSTEMS, c.app_system)}, deadline ${c.deadline ?? "not set"}` +
        (c.ai_policy === "no_drafting" ? ". NO AI DRAFTING: questions and fact checks only." : ""),
    );
    for (const p of piecesFor(c.id)) lines.push(pieceLine(p));
  }
  const shared = piecesFor(null);
  if (shared.length) {
    lines.push("", "## Pieces shared across colleges");
    for (const p of shared) lines.push(pieceLine(p));
  }
  return lines.join("\n");
}

export function renderPiece(p: PieceInfo, body: string): string {
  const noDrafting = p.college?.ai_policy === "no_drafting";
  const used = p.limit_kind === "chars" ? countChars(body) : countWords(body);
  const lines = [
    `# ${p.title} [piece_id: ${p.id}]`,
    p.college ? `College: ${p.college.name}${p.college.deadline ? `, deadline ${p.college.deadline}` : ""}` : "Shared across colleges",
    noDrafting
      ? "AI POLICY: this college does not allow AI help with drafting. Do not propose wording or write sentences for this piece. Ask questions, point out unclear spots, and check facts only; suggest_edits is disabled here."
      : "AI policy: suggestions allowed (the student accepts or declines each one).",
    `Status: ${labelOf(PIECE_STATUSES, p.status)}`,
    `Limit: ${limitLine(p.limit_kind, p.limit_value)}. Currently ${used} ${p.limit_kind === "chars" ? "characters" : "words"}.`,
    "",
    "## Prompt",
    p.prompt || "(no prompt entered)",
    "",
    "## The student's text, as it is now",
    body || "(empty: the student hasn't started writing)",
  ];
  if (p.notes) lines.push("", "## The student's notes (not part of the essay)", p.notes);
  if (p.college?.research) lines.push("", `## The student's research on ${p.college.name}`, p.college.research);
  if (p.student?.about) lines.push("", "## About the student (in their words)", p.student.about);
  if (p.other_pieces.length) {
    lines.push("", "## Other pieces for the same college");
    for (const o of p.other_pieces) {
      lines.push(`### ${o.title} [piece_id: ${o.id}]`, o.prompt ? `Prompt: ${o.prompt}` : "", o.text || "(empty)", "");
    }
  }
  if (p.open_suggestions.length) {
    lines.push("", "## Suggestions already waiting for the student");
    for (const s of p.open_suggestions) {
      const what =
        s.kind === "insert" ? `add "${s.body}"` : s.kind === "delete" ? `delete "${s.quote}"` : `replace "${s.quote}" with "${s.body}"`;
      lines.push(`- ${s.author}${s.source === "ai" ? " (AI)" : ""}: ${what}${s.note ? `. Reason: ${s.note}` : ""}`);
    }
  }
  return lines.join("\n");
}

async function loadPiece(sb: SupabaseClient, token: string, pieceId: string) {
  const { data, error } = await sb.rpc("connector_piece", { token, piece: pieceId });
  if (error) throw new Error(error.message);
  const p = data as PieceInfo;
  const doc = docFromRows(p.doc_state, p.updates);
  const flat = flatten(doc);
  doc.destroy();
  return { p, flat };
}

const pieceId = z.string().uuid().describe("The piece_id from list_my_desk.");

export function registerTools(server: McpServer, token: string) {
  server.registerTool(
    "list_my_desk",
    {
      title: "List my colleges and essays",
      description:
        "The student's colleges (with deadlines and each college's AI policy) and every piece of writing, with ids, status and word counts.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await db().rpc("connector_desk", { token });
      if (error) return fail(error.message);
      return text(renderDesk(data as DeskInfo));
    },
  );

  server.registerTool(
    "read_piece",
    {
      title: "Read an essay",
      description:
        "One piece of writing: its prompt, limit, current text, the student's notes and research, the college's AI policy, the other pieces for that college, and suggestions already waiting.",
      inputSchema: z.object({ piece_id: pieceId }),
      annotations: { readOnlyHint: true },
    },
    async ({ piece_id }) => {
      try {
        const { p, flat } = await loadPiece(db(), token, piece_id);
        return text(renderPiece(p, flat.text));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "suggest_edits",
    {
      title: "Suggest edits",
      description:
        "Propose specific edits to a piece. Each edit appears on the student's desk as a suggestion they accept or decline; nothing changes the essay until they accept. " +
        "For each edit, quote the exact current text in `find` (enough words to be unique), then give either `replace_with` (use an empty string to delete) or `insert_after`. " +
        "Keep edits small and in the student's voice, never add facts the student hasn't stated, and give a short reason. Not allowed for colleges that bar AI drafting help.",
      inputSchema: z.object({
        piece_id: pieceId,
        edits: z
          .array(
            z.object({
              find: z.string().min(1).describe("Exact text as it currently appears in the piece. Must occur exactly once."),
              replace_with: z.string().optional().describe("Replacement text. Empty string deletes the found text."),
              insert_after: z.string().optional().describe("Text to insert right after the found text, instead of replacing it."),
              reason: z.string().min(1).max(600).describe("Why, in a sentence, for the student."),
            }),
          )
          .min(1)
          .max(25),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ piece_id, edits }) => {
      const sb = db();
      try {
        const { p, flat } = await loadPiece(sb, token, piece_id);
        if (p.college?.ai_policy === "no_drafting") {
          return fail(
            `${p.college.name} does not allow AI help with drafting, so edits can't be suggested for this piece. You can still ask the student questions and check facts.`,
          );
        }
        if (!flat.text.trim()) {
          return fail("The student hasn't written anything in this piece yet. Ask them questions to help them start; the student writes the first draft.");
        }
        const rows: AnchoredRow[] = [];
        const report: string[] = [];
        edits.forEach((e, i) => {
          const r = anchorEdit(flat, e);
          if (r.ok) {
            rows.push(r.row);
            report.push(`${i + 1}. added`);
          } else report.push(`${i + 1}. not added: ${r.reason}`);
        });
        if (rows.length) {
          const { error } = await sb.rpc("connector_add_suggestions", { token, piece: piece_id, rows });
          if (error) return fail(error.message);
        }
        const head = rows.length
          ? `${rows.length} suggestion${rows.length === 1 ? "" : "s"} added to "${p.title}". The student will see them on their desk and accept or decline each one.`
          : "No suggestions were added.";
        return { content: [{ type: "text", text: `${head}\n${report.join("\n")}` }], isError: rows.length === 0 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
