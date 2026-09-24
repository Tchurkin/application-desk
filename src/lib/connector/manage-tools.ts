import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { db, fail, text } from "./tools";

/*
 * Setting up and managing the desk through the connector: colleges, their pieces, and the
 * student's profile. A student can paste the list of colleges they're applying to and have
 * Claude or ChatGPT build the whole desk.
 */

const APP_SYSTEM = z
  .enum(["common_app", "coalition", "uc", "applytexas", "ucas", "questbridge", "own_portal", "other"])
  .describe("How the student applies: common_app, coalition (Coalition/Scoir), uc, applytexas, ucas, questbridge, own_portal, other.");
const ROUND = z
  .enum(["ED", "ED2", "EA", "REA", "RD", "rolling", "priority"])
  .describe("ED, ED2, EA, REA (restrictive early action), RD, rolling, priority.");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const LIMIT_KIND = z.enum(["words", "chars", "none"]);

const PieceSpec = z.object({
  title: z.string().min(1).max(300).describe('Short name, e.g. "Why Northfield?" or "Community essay".'),
  prompt: z.string().optional().describe("The prompt exactly as the college asks it."),
  limit_kind: LIMIT_KIND.optional(),
  limit_value: z.number().int().positive().optional(),
  due: DATE.optional().describe("When the student wants this piece finished, YYYY-MM-DD (before the college's deadline)."),
});

const CollegeSpec = z.object({
  name: z.string().min(1).max(200),
  app_system: APP_SYSTEM.optional(),
  round: ROUND.optional(),
  deadline: DATE.optional().describe("Application deadline for the chosen round, YYYY-MM-DD."),
  materials_deadline: DATE.optional(),
  needs_letters: z.boolean().optional(),
  ai_policy: z.enum(["allowed", "no_drafting"]).optional().describe("no_drafting if the college doesn't allow AI help with drafting."),
  research: z.string().optional().describe("Notes about the college for the student (programs, why it fits)."),
  pieces: z.array(PieceSpec).optional().describe("Every supplemental essay and short answer the college asks for."),
});

interface SetUpResult {
  name: string;
  college_id: string;
  created: boolean;
  pieces: { title: string; piece_id: string; created: boolean }[];
}

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/** Only the keys the caller set, so a partial update leaves the rest alone. */
function defined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function registerManageTools(server: McpServer, token: string) {
  server.registerTool(
    "set_up_colleges",
    {
      title: "Set up colleges",
      description:
        "Add colleges to the desk, each with its application details and a piece for every supplemental prompt, with the prompt's exact wording and its word or character limit. " +
        "Colleges and pieces already on the desk (same name / same title) are kept, not duplicated, and filled in with the details you send (prompts, limits, due dates, deadlines), " +
        "so this is safe to call again with more, or to complete pieces the student added by hand.",
      inputSchema: z.object({ colleges: z.array(CollegeSpec).min(1).max(40) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ colleges }) => {
      try {
        const out = (await rpc("connector_set_up_colleges", { token, colleges })) as SetUpResult[];
        const lines = out.map((c) => {
          const made = c.pieces.filter((p) => p.created).length;
          const kept = c.pieces.length - made;
          return (
            `- ${c.name} [college_id: ${c.college_id}] ${c.created ? "added" : "already on the desk, details filled in"}` +
            (c.pieces.length ? `; ${made} piece${made === 1 ? "" : "s"} added${kept ? `, ${kept} already there and updated` : ""}` : "") +
            c.pieces.map((p) => `\n    ${p.title} [piece_id: ${p.piece_id}]`).join("")
          );
        });
        return text(`Desk set up:\n${lines.join("\n")}`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_college",
    {
      title: "Change a college",
      description: "Change any detail of a college: name, system, round, deadlines, whether it needs letters, AI policy, research notes. Omitted fields stay as they are.",
      inputSchema: z.object({
        college_id: z.string().uuid(),
        name: z.string().min(1).max(200).optional(),
        app_system: APP_SYSTEM.optional(),
        round: ROUND.optional(),
        deadline: DATE.or(z.literal("")).optional().describe("YYYY-MM-DD, or empty to clear."),
        materials_deadline: DATE.or(z.literal("")).optional(),
        needs_letters: z.boolean().optional(),
        ai_policy: z.enum(["allowed", "no_drafting"]).optional(),
        research: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ college_id, ...fields }) => {
      try {
        await rpc("connector_update_college", { token, college: college_id, fields: defined(fields) });
        return text("College updated.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_piece",
    {
      title: "Change a piece's details",
      description:
        "Change a piece's title, prompt, word or character limit, due date, status (not_started, drafting, needs_review, final, submitted), notes, or move it to another college (college_id null for shared). To change its text, use write_piece or edit_piece.",
      inputSchema: z.object({
        piece_id: z.string().uuid(),
        title: z.string().min(1).max(300).optional(),
        prompt: z.string().optional(),
        limit_kind: LIMIT_KIND.optional(),
        limit_value: z.number().int().min(0).optional().describe("0 clears the limit."),
        due: DATE.or(z.literal("")).optional().describe("When the student wants it finished, YYYY-MM-DD, or empty to clear."),
        status: z.enum(["not_started", "drafting", "needs_review", "final", "submitted"]).optional(),
        notes: z.string().optional(),
        college_id: z.string().uuid().nullable().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ piece_id, ...fields }) => {
      try {
        await rpc("connector_update_piece", { token, piece: piece_id, fields: defined(fields) });
        return text("Piece updated.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_college",
    {
      title: "Remove a college",
      description: "Remove a college from the desk, with all of its pieces, their text and history. This can't be undone.",
      inputSchema: z.object({ college_id: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ college_id }) => {
      try {
        await rpc("connector_delete_college", { token, college: college_id });
        return text("College removed.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_piece",
    {
      title: "Remove a piece",
      description: "Remove one piece, with its text and history. This can't be undone.",
      inputSchema: z.object({ piece_id: z.string().uuid() }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ piece_id }) => {
      try {
        await rpc("connector_delete_piece", { token, piece: piece_id });
        return text("Piece removed.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_my_profile",
    {
      title: "Update the student's profile",
      description:
        'Set the student\'s first name and their "about me": activities, interests, background, what they want to study. It is used as context for every essay.',
      inputSchema: z.object({ name: z.string().max(80).optional(), about: z.string().optional() }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (fields) => {
      try {
        await rpc("connector_update_profile", { token, fields: defined(fields) });
        return text("Profile updated.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
