import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bridgeMissing } from "@/lib/bridge/requests";
import { fileKind, filledName, imageMime, renderFileList, type FileRow } from "@/lib/profile/files";
import { docxText } from "@/lib/profile/docx";
import { clipText, fillPdf, pdfFields, pdfText, renderPdf } from "@/lib/profile/pdf";
import { renderProfilePart, type ProfileInfo } from "@/lib/profile/render";
import { db, fail, text } from "./tools";

/*
 * The student's Profile page through the connector: sections about them (background,
 * activities, stories, values, goals) that Claude or ChatGPT reads before helping with any
 * essay, and writes itself, for example while interviewing the student. Next to the sections are
 * files the student uploaded (a school's form, a resume), which Claude reads and, for a PDF form,
 * fills in as a new copy.
 */

const NOT_YET =
  "The Profile page needs the desk's latest database update, which hasn't been applied yet. Tell the student that the site's owner needs to run it.";

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw new Error(bridgeMissing(error) ? NOT_YET : error.message);
  return data;
}

const sectionId = z.string().uuid().describe("The section_id from read_profile.");
const fileId = z.string().uuid().describe("The file_id from read_profile.");

/** The files, or [] on a database from before them (or when they can't be listed: the rest of the profile still comes). */
async function listFiles(token: string): Promise<FileRow[]> {
  const { data, error } = await db().rpc("connector_profile_files", { token });
  if (error) {
    if (!bridgeMissing(error)) console.error("connector_profile_files", error.message);
    return [];
  }
  return (data ?? []) as FileRow[];
}

async function loadFile(token: string, id: string) {
  const f = (await rpc("connector_profile_file", { token, f: id })) as { name: string; mime: string; size: number; b64: string };
  return { ...f, bytes: new Uint8Array(Buffer.from(f.b64, "base64")) };
}

/** Claude takes an image up to 5 MB once encoded. */
const IMAGE_MAX = 3_750_000;

export function registerProfileTools(server: McpServer, token: string) {
  server.registerTool(
    "read_profile",
    {
      title: "Read the student's profile",
      description:
        "The student's Profile page: their academics, every section about them (background, activities, stories, values, goals, and anything else they or you added) with section ids, and the files they uploaded (school forms, a resume) with file ids. " +
        "It is the ground truth about the student. A long profile comes in parts: each reply says which part it is and how to ask for the next; read them all.",
      inputSchema: z.object({ part: z.number().int().min(1).optional().describe("Which part of a long profile, from 1 (the default).") }),
      annotations: { readOnlyHint: true },
    },
    async ({ part }) => {
      try {
        const [profile, files] = await Promise.all([rpc("connector_profile", { token }), listFiles(token)]);
        const out = renderProfilePart(profile as ProfileInfo, part ?? 1);
        const list = out.part === 1 ? renderFileList(files) : "";
        if (!list) return text(out.text);
        // The file list goes before the note saying which part this is.
        const at = out.parts > 1 ? out.text.lastIndexOf("\n\n[Part ") : -1;
        return text(at >= 0 ? `${out.text.slice(0, at)}\n\n${list}${out.text.slice(at)}` : `${out.text}\n\n${list}`);
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

  server.registerTool(
    "read_profile_file",
    {
      title: "Read a file on the profile",
      description:
        "Read one file from the student's Profile page (file ids from read_profile). A PDF comes with its text and its fillable form fields, which fill_pdf_form fills in by name; " +
        "an image comes as the image; a Word or text file comes as its text.",
      inputSchema: z.object({ file_id: fileId }),
      annotations: { readOnlyHint: true },
    },
    async ({ file_id }) => {
      try {
        const f = await loadFile(token, file_id);
        const kind = fileKind(f);
        if (kind === "pdf") {
          // Apart, so a form pdf-lib can't read still comes with its text.
          const [fields, pages] = await Promise.allSettled([pdfFields(f.bytes), pdfText(f.bytes)]);
          if (pages.status === "rejected" && fields.status === "rejected") throw pages.reason;
          return text(renderPdf(f.name, fields.status === "fulfilled" ? fields.value : [], pages.status === "fulfilled" ? pages.value : []));
        }
        if (kind === "image") {
          if (f.bytes.length > IMAGE_MAX) return fail(`${f.name} is too large to show here. Ask the student to upload a smaller copy.`);
          return {
            content: [
              { type: "text" as const, text: `# ${f.name}` },
              { type: "image" as const, data: Buffer.from(f.bytes).toString("base64"), mimeType: imageMime(f) },
            ],
          };
        }
        if (kind === "word") return text(`# ${f.name}\n\n${clipText(docxText(f.bytes))}`);
        if (kind === "text") return text(`# ${f.name}\n\n${clipText(new TextDecoder().decode(f.bytes))}`);
        return fail(`${f.name} is a kind of file that can't be read here. The student can open it on their Profile page and tell you what's in it.`);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "fill_pdf_form",
    {
      title: "Fill in a PDF form",
      description:
        "Fill in a PDF form on the student's Profile page and save the filled copy next to it (the original stays as it was). Read it first with read_profile_file for the field names. " +
        "Use only what you know from the student and their profile; leave out anything you don't know and ask the student for it. Signatures are left for the student.",
      inputSchema: z.object({
        file_id: fileId,
        fields: z
          .record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.array(z.string())]))
          .describe(
            'Field name to value: text for a text field, true or false for a checkbox, the option for a choice. For example {"Student name": "Testy Student", "Waive access": true}.',
          ),
        save_as: z.string().max(200).optional().describe('The new file\'s name (by default, the form\'s name with "(filled)").'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ file_id, fields, save_as }) => {
      if (!Object.keys(fields).length) return fail("Give at least one field to fill in.");
      try {
        const f = await loadFile(token, file_id);
        if (fileKind(f) !== "pdf") return fail(`${f.name} isn't a PDF.`);
        const r = await fillPdf(f.bytes, fields);
        const skipped = r.skipped.map((s) => `- "${s.name}": ${s.why}`).join("\n");
        if (!r.filled.length) return fail(`Nothing was filled in, so no copy was saved.\n${skipped}`);
        const name = filledName(f.name, save_as);
        const id = await rpc("connector_add_profile_file", {
          token,
          file_name: name,
          file_mime: "application/pdf",
          b64: Buffer.from(r.bytes).toString("base64"),
        });
        return text(
          `Filled ${r.filled.length} field${r.filled.length === 1 ? "" : "s"} and saved "${name}" [file_id: ${id}] on the student's Profile page, next to the original.` +
            (skipped ? `\nNot filled:\n${skipped}` : ""),
        );
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );
}
