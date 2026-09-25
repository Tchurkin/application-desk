import "server-only";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { bandOf, BANDS, formatPercent, isInternational } from "@/lib/strategy/bands";
import { catalogCandidates, matchCollege } from "@/lib/strategy/catalog";
import { renderStrategy, type StrategyInfo } from "@/lib/strategy/render";
import { db, fail, text } from "./tools";

/**
 * Connector tools for the Strategy page: read_strategy (odds, fit, cost and the published
 * College Scorecard baseline for every college, plus the student's academic profile),
 * set_college_strategy (odds with reasoning, fit, campus life, reputation, cost, international
 * details) and update_academics (GPA, test scores, intended major). Registered from
 * src/app/api/mcp/[token]/route.ts.
 */

const HOW_TO_ESTIMATE =
  "To estimate a college's chance: start from its published admission rate (read_strategy), then adjust for how the student's GPA and test scores compare with the college's admitted students (average SAT/ACT), " +
  "how selective the college is for the student's intended major (engineering, computer science and nursing are often far harder than the overall rate), the round (ED and some EA rounds admit at higher rates), " +
  "and anything the student has told you about activities, awards and circumstances. Be honest rather than encouraging: never inflate, and a college admitting under about 15% is a reach for everyone. " +
  "Put your reasoning in chance_note in one to three sentences the student can read. " +
  "With the chance, set fit_rank (1 = the best fit among all the student's colleges, each its own rank), campus_life and reputation (for their intended major, 0 to 10), judged for this student.";

const Fields = {
  chance_percent: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .describe(`Your estimate of this student's chance of admission, 0 to 100. The desk bands it: under 20 Reach, 20 to 60 Target, over 60 Likely. null clears it, and the desk falls back to the published average rate.`),
  chance_note: z.string().max(2000).optional().describe("Your reasoning for the chance, in one to three sentences the student reads on the desk."),
  fit_rank: z.number().int().positive().nullable().optional().describe("1 = the best fit for this student among their colleges, 2 = next, and so on."),
  campus_life: z.number().int().min(0).max(10).nullable().optional().describe("How well campus life suits the student, 0 to 10."),
  reputation: z.number().int().min(0).max(10).nullable().optional().describe("Reputation for the student's intended major, 0 to 10."),
  cost_sticker: z.number().int().min(0).nullable().optional().describe("Yearly cost of attendance before aid, USD."),
  cost_net: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .describe("Yearly cost after grants and aid for this student, USD. Prefer a figure from the college's net price calculator."),
  country: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('"US" for a US college; otherwise its country (e.g. "United Kingdom"). A college outside the US is shown without a percentage, described by the intl_* fields.'),
  intl_course: z.string().max(500).optional().describe("Outside the US: the course or program and its length."),
  intl_criterion: z.string().max(500).optional().describe("Outside the US: what decides admission (required exam grades, a selection test, a ranked procedure)."),
  intl_cost: z.string().max(500).optional().describe("Outside the US: cost a year as text, in local currency if that's clearer (e.g. \"~£28,000\")."),
  intl_status: z
    .string()
    .max(500)
    .optional()
    .describe("Outside the US: where it stands, e.g. \"✓ bar met\", \"⏳ awaiting reply\", \"✗ not met\", with the next step."),
  scorecard_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("The college's College Scorecard UNITID, to link the published baseline when its name matches several colleges or none."),
};

const Entry = z.object({ college_id: z.string().uuid().describe("The college_id from read_strategy or list_my_desk."), ...Fields });
type EntryT = z.infer<typeof Entry>;

/** A database a migration behind: say so instead of a raw Postgres error. */
function friendly(message: string): string {
  if (/connector_(strategy|set_strategy|update_academics)|schema cache|does not exist/i.test(message)) {
    return "Strategy isn't available on this desk yet: its database needs the latest update. The student can tell whoever runs their Application Desk.";
  }
  return message;
}

async function loadStrategy(token: string): Promise<StrategyInfo> {
  const { data, error } = await db().rpc("connector_strategy", { token });
  if (error) throw new Error(friendly(error.message));
  return data as StrategyInfo;
}

/** Only the keys the caller set, so a partial update leaves the rest alone. */
function defined(o: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function registerStrategyTools(server: McpServer, token: string) {
  server.registerTool(
    "read_strategy",
    {
      title: "Read admission strategy",
      description:
        "The student's academic profile (GPA, test scores, intended major, about) and every college's admission odds, fit, campus life, reputation and cost, " +
        "beside the college's published baseline from the U.S. College Scorecard (admission rate, average SAT/ACT, cost of attendance, average net price). " +
        "Read this before estimating odds, then save them with set_college_strategy.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const data = await loadStrategy(token);
        return text(renderStrategy(data, { match: matchCollege, candidates: catalogCandidates }));
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "set_college_strategy",
    {
      title: "Set a college's odds and strategy",
      description:
        "Set admission odds (chance_percent with chance_note), fit rank, campus life, reputation, cost, or details for a college outside the US. " +
        "Pass one college (college_id plus the fields to set) or several at once (colleges: [...]); fields left out are unchanged. " +
        HOW_TO_ESTIMATE,
      inputSchema: z.object({
        college_id: z.string().uuid().optional().describe("One college's id; or use `colleges` for several."),
        ...Fields,
        colleges: z.array(Entry).min(1).max(60).optional().describe("Several colleges at once, each with its college_id and fields."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ colleges, college_id, ...fields }) => {
      const list: EntryT[] = colleges ?? (college_id ? [{ college_id, ...fields }] : []);
      if (!list.length) return fail("Give college_id with the fields to set, or colleges: [{college_id, ...}, ...].");
      try {
        const desk = await loadStrategy(token);
        const byId = new Map(desk.colleges.map((c) => [c.id, c]));
        const report: string[] = [];
        let done = 0;
        for (const { college_id: id, ...rest } of list) {
          const college = byId.get(id);
          const set = defined(rest);
          if (!college) {
            report.push(`- ${id}: not on this desk (see read_strategy for college ids)`);
            continue;
          }
          if (!Object.keys(set).length) {
            report.push(`- ${college.name}: nothing to set`);
            continue;
          }
          const { error } = await db().rpc("connector_set_strategy", { token, college: id, fields: set });
          if (error) {
            report.push(`- ${college.name}: not saved (${friendly(error.message)})`);
            continue;
          }
          done++;
          const country = (set.country as string | undefined) ?? college.country;
          const where =
            typeof set.chance_percent === "number" && !isInternational(country)
              ? `: ${formatPercent(set.chance_percent)}, ${BANDS.find((b) => b.id === bandOf(set.chance_percent as number))?.title}`
              : isInternational(country)
                ? ": outside the US"
                : "";
          report.push(`- ${college.name}${where} (${Object.keys(set).join(", ")})`);
        }
        const head = done
          ? `Updated ${done} college${done === 1 ? "" : "s"}. The student's Strategy page shows the change.`
          : "Nothing was updated.";
        return { content: [{ type: "text", text: `${head}\n${report.join("\n")}` }], isError: done === 0 };
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    "update_academics",
    {
      title: "Update the academic profile",
      description:
        "Save the student's academics: GPA (with its scale and whether weighted, e.g. \"3.92 unweighted, 4.41 weighted\"), test scores (e.g. \"SAT 1480 (760 math)\" or \"test-optional\"), " +
        "intended major, class rank, and coursework (from a transcript: a compact summary by year of each course, its level and grade). " +
        "Fields left out are unchanged; an empty string clears one. These are the basis for odds estimates.",
      inputSchema: z.object({
        gpa: z.string().max(80).optional(),
        test_scores: z.string().max(200).optional(),
        intended_major: z.string().max(200).optional(),
        class_rank: z.string().max(80).optional().describe('e.g. "12 of 412" or "top 5%"'),
        coursework: z.string().max(4000).optional().describe("Courses by year with level and grade, then totals."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const fields = defined(args);
      if (!Object.keys(fields).length) return fail("Give at least one of gpa, test_scores, intended_major, class_rank, coursework.");
      // A database before migration 20261006 has no class rank or coursework, and would drop them silently.
      const newer = ["class_rank", "coursework"].filter((k) => k in fields);
      let skipped: string[] = [];
      if (newer.length) {
        const { data } = await db().rpc("connector_strategy", { token });
        const student = (data as { student?: Record<string, unknown> | null } | null)?.student;
        if (student && !("class_rank" in student)) {
          skipped = newer;
          for (const k of newer) delete fields[k as keyof typeof fields];
          if (!Object.keys(fields).length) {
            return fail("Class rank and coursework can't be saved yet: this desk's database needs its latest update. Tell the student; the rest of their academics can still be saved.");
          }
        }
      }
      const { error } = await db().rpc("connector_update_academics", { token, fields });
      if (error) return fail(friendly(error.message));
      const note = skipped.length ? ` Not saved (the desk's database needs its latest update): ${skipped.join(", ").replace(/_/g, " ")}.` : "";
      return text(`Saved the student's ${Object.keys(fields).join(", ").replace(/_/g, " ")}.${note}`);
    },
  );
}
