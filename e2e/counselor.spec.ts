import { readFileSync } from "node:fs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { COUNSELOR_VERSION } from "../src/lib/counselor/version";
import { addCollege, addPiece, apiClient, signUp } from "./helpers";

/*
 * The Counselor page, driven the way the counselor on a student's computer drives the desk: the
 * same database calls its watcher makes (poll, draft, finish, activity, removed) and the same
 * work endpoint, so no real Claude is needed.
 */

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

type Poll = { fresh: number; waiting: number; speed: string; model: string; effort: string; paused: boolean; remove: boolean };

function counselorApi(token: string) {
  const api = apiClient();
  return {
    poll: async (version = COUNSELOR_VERSION) => {
      const { data, error } = await api.rpc("connector_counselor_poll", { token, version });
      if (error) throw new Error(error.message);
      return data as Poll;
    },
    rpc: (fn: string, args: Record<string, unknown>) => api.rpc(fn, { token, ...args }),
  };
}

const chat = (p: Page) => p.getByTestId("counselor-chat");
const card = (p: Page) => p.getByTestId("counselor-card");

test("talking to the counselor: live drafts, models, pause, and removing it from the computer", async ({ page, request }) => {
  await signUp(page, "counselor");
  await page.goto("/desk/counselor");
  await expect(card(page)).toContainText("Set up your counselor");

  // A message waits on the desk until someone picks it up.
  await chat(page).getByRole("button", { name: "What should I work on this week?" }).click();
  await expect(chat(page)).toContainText("Waiting for Claude");

  const token = (await makeConnector(page)).split("/api/mcp/")[1];
  const c = counselorApi(token);

  // An older counselor shows up with an update on offer.
  expect(await c.poll("1")).toMatchObject({ fresh: 1, waiting: 1, speed: "balanced", model: "sonnet", effort: "medium", paused: false, remove: false });
  await page.goto("/desk/counselor");
  await expect(card(page).getByTestId("counselor-update")).toBeVisible();
  expect((await c.poll()).fresh).toBe(0);
  await page.reload();
  await expect(card(page).getByTestId("counselor-update")).toHaveCount(0);
  await expect(card(page).getByTestId("counselor-state")).toContainText("On");
  await expect(chat(page)).toContainText("Your counselor has it");

  // Its work comes with everything needed to answer by replying.
  const work = await request.get(`/api/counselor/${token}`);
  expect(work.ok()).toBe(true);
  const { requests } = (await work.json()) as { requests: { id: string; kind: string; text: string }[] };
  expect(requests).toHaveLength(1);
  expect(requests[0].kind).toBe("chat");
  expect(requests[0].text).toContain("What should I work on this week?");
  expect(requests[0].text).toContain("don't call answer_request");
  const id = requests[0].id;

  // What it's doing, then the answer as it's written, then the answer.
  await c.rpc("connector_activity", { tool: "thinking", request: id });
  await expect(chat(page)).toContainText("Your counselor is thinking", { timeout: 20_000 });
  await c.rpc("connector_draft_answer", { request: id, draft: "Start with **Why Northfield**" });
  await expect(chat(page).getByTestId("draft-answer")).toContainText("Start with Why Northfield");
  const { data: finished } = await c.rpc("connector_finish_request", { request: id, answer_text: "Start with **Why Northfield**, then the Community essay." });
  expect(finished).toBe(true);
  await expect(chat(page).locator("strong", { hasText: "Why Northfield" })).toBeVisible();
  await expect(chat(page)).not.toContainText("writing…");
  await expect(page.getByTestId("recent-work")).toContainText("Answered in");
  const { data: again } = await c.rpc("connector_finish_request", { request: id, answer_text: "Again." });
  expect(again).toBe(false);

  // The counselor's model and how hard it thinks.
  await card(page).getByRole("radiogroup", { name: "Model" }).getByRole("radio", { name: "Opus" }).click();
  await expect.poll(async () => (await c.poll()).model).toBe("opus");
  await card(page).getByRole("radiogroup", { name: "Thinking" }).getByRole("radio", { name: "High" }).click();
  await expect.poll(async () => (await c.poll()).effort).toBe("high");
  expect((await c.poll()).speed).toBe("thorough");
  await expect(card(page).getByRole("radio", { name: "Opus" })).toHaveAttribute("aria-checked", "true");

  // Paused, it picks nothing up; resumed, it does.
  await card(page).getByRole("button", { name: "Pause" }).click();
  await expect.poll(async () => (await c.poll()).paused).toBe(true);
  // This one asks for a model of its own.
  await chat(page).getByLabel("Model").selectOption("haiku");
  await chat(page).getByLabel("Message your counselor").fill("Is my list balanced?");
  await chat(page).getByRole("button", { name: "Send", exact: true }).click();
  await expect(chat(page)).toContainText("Is my list balanced?");
  expect(await c.poll()).toMatchObject({ fresh: 0, waiting: 1, paused: true });
  await page.reload();
  await expect(card(page).getByTestId("counselor-state")).toContainText("Paused");
  await card(page).getByRole("button", { name: "Resume" }).click();
  await expect.poll(async () => (await c.poll()).fresh).toBe(1);
  const later = (await (await request.get(`/api/counselor/${token}`)).json()) as { requests: { text: string; model: string }[] };
  expect(later.requests.find((r) => r.text.includes("Is my list balanced?"))?.model).toBe("haiku");

  // Removing it from the computer: it's asked to, does, and its link is gone.
  await card(page).getByRole("button", { name: "Remove from computer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
  await expect(card(page).getByTestId("counselor-removing")).toBeVisible();
  expect(await c.poll()).toMatchObject({ remove: true, fresh: 0 });
  expect((await c.rpc("connector_counselor_removed", {})).error).toBeNull();
  await page.reload();
  await expect(card(page)).toContainText("Set up your counselor");
  await expect(c.poll()).rejects.toThrow(/not valid/);
});

test.describe("on a Windows computer", () => {
  test.use({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36" });

  test("updating an older counselor: the old one answers until the new one starts, with the same settings", async ({ page }) => {
    await signUp(page, "counselorupdate");
    const token = (await makeConnector(page)).split("/api/mcp/")[1];
    const old = counselorApi(token);
    await old.poll("1");
    await page.goto("/desk/counselor");
    await card(page).getByRole("radio", { name: "Haiku" }).click();
    await expect.poll(async () => (await old.poll("1")).model).toBe("haiku");

    const [download] = await Promise.all([page.waitForEvent("download"), card(page).getByRole("button", { name: "Update the counselor" }).click()]);
    expect(download.suggestedFilename()).toBe("Application Desk counselor setup.cmd");
    await expect(card(page).getByTestId("counselor-update-pending")).toBeVisible();
    await expect(page.getByTestId("counselor-steps")).toBeVisible();
    const file = readFileSync((await download.path())!, "utf8");
    const fresh = file.match(/\$Token = '([A-Za-z0-9_-]+)'/)![1];
    expect(fresh).not.toBe(token);

    // Until the new counselor runs, the old one keeps working.
    expect((await old.poll("1")).model).toBe("haiku");
    // The new one's first check-in turns the old one off.
    expect(await counselorApi(fresh).poll()).toMatchObject({ model: "haiku", paused: false });
    await expect(old.poll("1")).rejects.toThrow(/not valid/);
    await page.reload();
    await expect(card(page).getByTestId("counselor-state")).toContainText("On");
    await expect(card(page).getByTestId("counselor-update")).toHaveCount(0);
    await expect(card(page).getByTestId("counselor-update-pending")).toHaveCount(0);
  });
});

test("the desk shows what an assistant is doing through the connector", async ({ page }) => {
  await signUp(page, "counselordoing");
  await addCollege(page, "Doing College");
  const pieceId = await addPiece(page, "Why us");
  const url = await makeConnector(page);
  const client = await connect(url);
  // The counselor checks in, then reads the piece.
  await counselorApi(url.split("/api/mcp/")[1]).poll();
  await client.callTool({ name: "read_piece", arguments: { piece_id: pieceId } });
  await page.goto(`/desk/piece/${pieceId}`);
  if (!(await page.getByTestId("ask-panel").isVisible())) await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("watch-status")).toContainText("Your counselor is reading “Why us”");
  await client.close();
});
