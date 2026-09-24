import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bridgeMissing } from "@/lib/bridge/requests";
import { renderProfile, type ProfileInfo } from "@/lib/profile/render";
import { db, fail, text } from "./tools";

/*
 * The student's Profile page through the connector: sections about them (background,
 * activities, stories, values, goals) that Claude or ChatGPT reads before helping with any
 * essay, and writes itself, for example while interviewing the student.
 */

const NOT_YET =
  "The Profile page needs the desk's latest database update, which hasn't been applied yet. Tell the student that the site's owner needs to run it.";

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(bridgeMissing(error) ? NOT_YET : error.message);
  return data;
}

const sectionId = z.string().uuid().describe("The section_id from read_profile.");

export function registerProfileTools(server: McpServer, token: string) {
  server.registerTool(
    "read_profile",
    {
      title: "Read the student's profile",
      description:
        "The student's Profile page: their academics and every section about them (background, activities, stories, values, goals, and anything else they or you added), with section ids.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        return text(renderProfile((await rpc("connector_profile", { token })) as ProfileInfo));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "save_profile_section",
    {
      title: "Add or rewrite a profile section",
      description:
        "Add a section to the student's profile (leave section_id out; it goes last) or rewrite one (give its section_id; fields left out stay). " +
        "Organize by topic with a short title, and keep the student's own words and concrete details: moments, people, numbers, what changed. Never invent anything.",
      inputSchema: z.object({
        section_id: sectionId.optional(),
        title: z.string().max(200).optional().describe('e.g. "Robotics", "Family", "Why engineering".'),
        body: z.string().max(20000).optional().describe("The section's text; paragraphs and simple \"- \" lists are fine."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ section_id, title, body }) => {
      if (!section_id && !title?.trim() && !body?.trim()) return fail("Give the new section a title or some text.");
      try {
        const fields = Object.fromEntries(Object.entries({ title, body }).filter(([, v]) => v !== undefined));
        const id = await rpc("connector_save_profile_section", { token, section: section_id ?? null, fields });
        return text(section_id ? "Section updated. The student sees it on their Profile page." : `Section added [section_id: ${id}].`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "order_profile_sections",
    {
      title: "Reorder the profile",
      description: "Put the profile's sections in this order (section ids from read_profile). Sections left out keep their order after these.",
      inputSchema: z.object({ section_ids: z.array(z.string().uuid()).min(1).max(200) }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ section_ids }) => {
      try {
        await rpc("connector_order_profile", { token, ids: section_ids });
        return text("Profile reordered.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "delete_profile_section",
    {
      title: "Remove a profile section",
      description: "Remove one section from the student's profile, for example after merging it into another. This can't be undone.",
      inputSchema: z.object({ section_id: sectionId }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ section_id }) => {
      try {
        await rpc("connector_delete_profile_section", { token, section: section_id });
        return text("Section removed.");
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
