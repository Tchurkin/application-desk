import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { addCollege, apiClient, signUp } from "./helpers";

/*
 * The Strategy page: colleges in Reach / Target / Likely by their chance (the published average
 * rate until someone sets one), edits by hand, odds set by the connected AI, colleges outside the
 * US, and the academic profile the AI estimates from.
 */

const band = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (page: Page, bandName: string, college: string) =>
  band(page, bandName).getByRole("row", { name: new RegExp(escape(college)) });

async function editChance(page: Page, college: string, chance: string) {
  await page.getByRole("button", { name: `Edit ${college}` }).click();
  const form = page.getByRole("form", { name: `Edit ${college}` });
  await form.getByLabel("Chance of admission (%)").fill(chance);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form).toHaveCount(0);
}

async function makeConnector(page: Page) {
  const back = page.url();
  await page.goto("/desk/settings");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  const url = await page.getByRole("textbox", { name: "Connector link" }).inputValue();
  await page.goto(back);
  return url;
}

async function connect(url: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  try {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult;
    return { text: r.content.map((c) => c.text ?? "").join("\n"), isError: !!r.isError };
  } catch (e) {
    return { text: (e as Error).message, isError: true };
  }
}

test("colleges sit in odds bands by published rate; a chance set by hand moves one", async ({ page }) => {
  await signUp(page, "strategy");
  await addCollege(page, "Purdue University-Main Campus"); // 49.9% published
  await addCollege(page, "Massachusetts Institute of Technology"); // 4.5%
  await addCollege(page, "University of Arizona"); // 86.1%
  await addCollege(page, "Northfield University"); // invented: not in the catalog

  await page.goto("/desk/strategy");
  await expect(page.getByRole("heading", { name: "Strategy", level: 1 })).toBeVisible();
  const mit = row(page, "Reach", "Massachusetts Institute of Technology");
  await expect(mit).toContainText("4.5%");
  await expect(mit).toContainText("Average rate");
  await expect(row(page, "Target", "Purdue University-Main Campus")).toContainText("49.9%");
  await expect(row(page, "Likely", "University of Arizona")).toContainText("86.1%");
  await expect(row(page, "Unrated", "Northfield University")).toContainText("Not set");
  await expect(band(page, "Reach")).toContainText("1 college");

  // The student's own number places Northfield, best fit first in its band.
  await page.getByRole("button", { name: "Edit Northfield University" }).click();
  const form = page.getByRole("form", { name: "Edit Northfield University" });
  await form.getByLabel("Chance of admission (%)").fill("45");
  await form.getByLabel("Fit rank (1 = best)").fill("1");
  await form.getByLabel("Net price per year after aid ($)").fill("21000");
  await form.getByRole("button", { name: "Save" }).click();
  const northfield = row(page, "Target", "Northfield University");
  await expect(northfield).toContainText("45%");
  await expect(northfield).toContainText("Your estimate");
  await expect(northfield).toContainText("#1");
  await expect(northfield).toContainText("$21k after aid");
  await expect(band(page, "Unrated")).toHaveCount(0);
  await expect(band(page, "Target").getByRole("row").nth(1)).toContainText("Northfield University");

  // Purdue down to a Reach by hand, then back to its published rate when cleared.
  await editChance(page, "Purdue University-Main Campus", "10");
  await expect(row(page, "Reach", "Purdue University-Main Campus")).toContainText("Your estimate");
  await expect(band(page, "Target")).not.toContainText("Purdue");
  await editChance(page, "Purdue University-Main Campus", "");
  const purdue = row(page, "Target", "Purdue University-Main Campus");
  await expect(purdue).toContainText("49.9%");
  await expect(purdue).toContainText("Average rate");

  // A college outside the US leaves the bands for its own section, described instead of rated.
  await page.getByRole("button", { name: "Edit Northfield University" }).click();
  await page.getByRole("form", { name: "Edit Northfield University" }).getByLabel("Country").fill("United Kingdom");
  await page.getByRole("form", { name: "Edit Northfield University" }).getByRole("button", { name: "Save" }).click();
  const abroad = band(page, "Outside the US");
  await expect(abroad.getByRole("row", { name: /Northfield University/ })).toContainText("United Kingdom");
  await expect(band(page, "Target")).not.toContainText("Northfield");

  await abroad.getByRole("button", { name: "Edit Northfield University" }).click();
  const intl = page.getByRole("form", { name: "Edit Northfield University" });
  await intl.getByLabel("Course").fill("Engineering, 4 years");
  await intl.getByLabel("What decides it").fill("A*AA including Maths and Physics");
  await intl.getByLabel("Where it stands").fill("Awaiting predicted grades");
  await intl.getByRole("button", { name: "Save" }).click();
  await expect(intl).toHaveCount(0);
  const kings = abroad.getByRole("row", { name: /Northfield University/ });
  await expect(kings).toContainText("A*AA including Maths and Physics");
  await expect(kings).toContainText("Awaiting predicted grades");

  // It all survives a reload.
  await page.reload();
  await expect(row(page, "Reach", "Massachusetts Institute of Technology")).toBeVisible();
  await expect(band(page, "Outside the US")).toContainText("Engineering, 4 years");
});

test("the connected AI estimates odds: the page waits for it and shows its numbers and reasoning", async ({ page, context }) => {
  const student = await signUp(page, "odds");
  await addCollege(page, "Purdue University-Main Campus");
  await addCollege(page, "Northfield University");
  await addCollege(page, "Kingsbridge University");

  await page.goto("/desk/strategy");
  const estimate = page.getByRole("region", { name: "Estimate your odds" });
  // Nothing connected yet: the page points to Settings.
  await expect(estimate).toContainText("Connect Claude or ChatGPT in Settings");
  await expect(estimate.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/desk/settings");

  const url = await makeConnector(page);
  await page.goto("/desk/strategy");

  // The link opens Claude with the handoff message, and queues the request on the desk.
  await context.route(/^https:\/\/claude\.ai\//, (r) => r.fulfill({ contentType: "text/html", body: "<title>Claude</title>" }));
  const [claude] = await Promise.all([
    context.waitForEvent("page"),
    estimate.getByRole("link", { name: "Estimate my odds with Claude" }).click(),
  ]);
  await claude.waitForURL(/claude\.ai\/new\?q=/);
  expect(claude.url()).toContain("set_college_strategy");
  await claude.close();
  await expect(estimate.getByRole("status")).toContainText("Waiting for Claude");

  const client = await connect(url);
  const read = await call(client, "read_strategy");
  expect(read.isError).toBe(false);
  expect(read.text).toContain("admission rate 49.9%");
  expect(read.text).toContain("Academic profile: not entered yet");
  const idOf = (name: string) => read.text.match(new RegExp(`${name} \\[college_id: ([0-9a-f-]{36})\\]`))![1];

  const set = await call(client, "set_college_strategy", {
    college_id: idOf("Northfield University"),
    chance_percent: 72,
    chance_note: "Scores above the admitted middle and a strong robotics fit.",
    fit_rank: 1,
  });
  expect(set.isError).toBe(false);
  expect(set.text).toContain("Northfield University: 72%, Likely");

  // Several at once, including a college outside the US.
  const many = await call(client, "set_college_strategy", {
    colleges: [
      {
        college_id: idOf("Kingsbridge University"),
        country: "United Kingdom",
        intl_course: "Engineering, 4 years",
        intl_criterion: "A*AA including Maths and Physics",
        intl_cost: "~£28,000",
        intl_status: "Awaiting predicted grades",
      },
      { college_id: idOf("Purdue University-Main Campus"), campus_life: 8, reputation: 9 },
    ],
  });
  expect(many.isError).toBe(false);
  expect(many.text).toContain("Updated 2 colleges");
  expect((await call(client, "set_college_strategy", { college_id: idOf("Purdue University-Main Campus"), chance_percent: 140 })).isError).toBe(true);

  // While it waits, the page picks up each change on its own (no reload).
  const likely = band(page, "Likely");
  const nrow = likely.getByRole("row", { name: /Northfield University/ });
  await expect(nrow).toContainText("AI estimate", { timeout: 15_000 });
  await expect(nrow).toContainText("72%");

  // The assistant closes the request (answer_request, tested with the bridge tools); here the
  // student's own session stands in for it.
  const api = apiClient();
  await api.auth.signInWithPassword({ email: student.email, password: student.password });
  const { data: closed } = await api
    .from("desk_requests")
    .update({ status: "answered", answer: "Northfield looks Likely; Purdue stays a Target.", answered_by: "Claude" })
    .eq("kind", "odds")
    .eq("status", "pending")
    .select("id");
  expect(closed).toHaveLength(1);
  await expect(estimate.getByRole("status")).toContainText("Northfield looks Likely", { timeout: 15_000 });
  await expect(estimate).not.toContainText("Waiting for Claude");

  await nrow.getByRole("button", { name: "Why?" }).click();
  await expect(likely).toContainText("Scores above the admitted middle and a strong robotics fit.");
  const purdue = row(page, "Target", "Purdue University-Main Campus");
  await expect(purdue).toContainText("8/10");
  await expect(purdue).toContainText("Average rate");
  const kings = band(page, "Outside the US").getByRole("row", { name: /Kingsbridge University/ });
  await expect(kings).toContainText("A*AA including Maths and Physics");
  await expect(kings).toContainText("~£28,000");
  await expect(band(page, "Outside the US")).not.toContainText("%");

  // The answer is remembered after a reload.
  await page.reload();
  await expect(estimate).toContainText("Last estimated");
  await expect(estimate.getByRole("link", { name: "Estimate my odds with Claude" })).toBeVisible();
  await client.close();
});

test("the academic profile saves in Settings and reaches the connected AI", async ({ page }) => {
  await signUp(page, "academics");
  await page.goto("/desk/settings");
  await page.getByLabel("GPA", { exact: true }).fill("3.9 unweighted");
  await page.getByLabel("Test scores", { exact: true }).fill("SAT 1450 (760 math)");
  await page.getByLabel("Intended major", { exact: true }).fill("Mechanical engineering");
  await page.getByRole("button", { name: "Save academics" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("GPA", { exact: true })).toHaveValue("3.9 unweighted");
  await expect(page.getByLabel("Test scores", { exact: true })).toHaveValue("SAT 1450 (760 math)");

  await page.goto("/desk/strategy");
  const card = page.getByRole("region", { name: "Academic profile" });
  await expect(card).toContainText("3.9 unweighted");
  await expect(card).toContainText("Mechanical engineering");

  const client = await connect(await makeConnector(page));
  const read = await call(client, "read_strategy");
  expect(read.text).toContain(
    "Academic profile: GPA 3.9 unweighted; test scores SAT 1450 (760 math); intended major Mechanical engineering.",
  );
  expect((await call(client, "update_academics", { intended_major: "Aerospace engineering" })).isError).toBe(false);
  await page.goto("/desk/settings");
  await expect(page.getByLabel("Intended major", { exact: true })).toHaveValue("Aerospace engineering");
  await expect(page.getByLabel("GPA", { exact: true })).toHaveValue("3.9 unweighted");
  await client.close();
});
