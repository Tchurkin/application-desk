import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, essay, signUp, waitSaved } from "./helpers";

/*
 * Ask: the student queues a question (or a polish request) beside a piece, the connected AI
 * picks it up through the connector and answers, and the answer shows up in the panel live.
 * The assistant's new tab is stubbed: window.open only records the URL it was given.
 */

async function stubWindowOpen(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __opened: string[] };
    w.__opened = [];
    window.open = ((url?: string | URL) => {
      w.__opened.push(String(url));
      return {} as Window;
    }) as typeof window.open;
  });
}

const opened = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

async function write(page: Page, text: string) {
  await essay(page).click();
  await page.keyboard.insertText(text);
  await waitSaved(page);
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

const panel = (page: Page) => page.getByTestId("ask-panel");
const askBox = (page: Page) => panel(page).getByRole("textbox", { name: "Ask about this piece" });
const requests = (page: Page) => panel(page).getByRole("list", { name: "Questions and answers" }).getByTestId("request");

/** Open the Ask tool beside the essay (it may already be open: the workspace remembers it). */
async function openAsk(page: Page) {
  await expect(essay(page)).toBeVisible();
  if (!(await askBox(page).isVisible())) await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(askBox(page)).toBeVisible();
}

const REQUEST_ID = /\[request_id: ([0-9a-f-]{36})\]/;

test("a question asked beside a piece is answered through the connector and appears live", async ({ page }) => {
  await stubWindowOpen(page);
  await signUp(page, "ask");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  const pieceId = await addPiece(page, "Why Northfield?", 250);
  await write(page, "I built a robot that sorts recycling. It taught me patience.");

  // Not connected yet: the panel says how to set up, and a question still waits on the desk.
  await openAsk(page);
  await expect(panel(page).getByRole("note", { name: "Set up Ask" })).toContainText("Settings");
  await askBox(page).fill("Is my opening strong enough?");
  await panel(page).getByRole("button", { name: "Ask Claude" }).click();
  const first = requests(page).filter({ hasText: "Is my opening strong enough?" });
  await expect(first).toContainText("Waiting for Claude");
  await expect(panel(page).getByRole("status")).toContainText("Connect Claude or ChatGPT in Settings");
  expect(await opened(page)).toEqual([]);

  const client = await connect(await makeConnector(page));
  await openAsk(page);
  await expect(panel(page).getByRole("note", { name: "Set up Ask" })).toHaveCount(0);
  await expect(first).toContainText("Waiting for Claude");

  // Connected: Enter sends, and Claude opens with the handoff message filled in.
  await askBox(page).fill("Should I cut the last sentence?");
  await askBox(page).press("Enter");
  await expect(requests(page)).toHaveCount(2);
  await expect(askBox(page)).toHaveValue("");
  // No new tab: the question waits for the Claude chat that is watching the desk.
  expect(await opened(page)).toEqual([]);
  await expect(panel(page).getByText("Nobody is watching your desk")).toBeVisible();

  // Claude, told to watch, gets the waiting questions straight away; the panel shows it watching.
  const watched = await call(client, "watch_desk");
  expect(watched.isError).toBe(false);
  expect(watched.text).toContain("call watch_desk again");
  await page.reload();
  await openAsk(page);
  await expect(page.getByTestId("watch-status")).toContainText("is watching your desk");

  // The assistant finds both, oldest first, with the piece and what to do.
  const list = await call(client, "list_desk_requests");
  expect(list.isError).toBe(false);
  expect(list.text).toContain("2 requests waiting");
  expect(list.text).toContain(`Piece: "Why Northfield?" [piece_id: ${pieceId}]`);
  expect(list.text).toContain("Is my opening strong enough?");
  expect(list.text).toContain("Should I cut the last sentence?");
  const id = list.text.match(REQUEST_ID)![1];

  const res = await call(client, "answer_request", {
    request_id: id,
    answer: "**Yes.** The robot is concrete and yours.\n\n- Keep the first sentence\n- Cut the second",
  });
  expect(res.isError).toBe(false);
  expect(res.text).toContain("1 more request waiting");

  // The answer arrives without a reload, formatted, and credited to Claude.
  await expect(first).not.toContainText("Waiting for Claude", { timeout: 15_000 });
  await expect(first.locator("strong", { hasText: "Yes." })).toBeVisible();
  await expect(first.getByRole("listitem")).toHaveText(["Keep the first sentence", "Cut the second"]);
  await expect(first.getByText(/^Claude( · .+)?$/)).toBeVisible();
  await expect(requests(page).filter({ hasText: "Should I cut the last sentence?" })).toContainText("Waiting for Claude");

  // An answered request is closed: answering again is refused, and only the other one waits.
  expect((await call(client, "answer_request", { request_id: id, answer: "Again." })).isError).toBe(true);
  const rest = await call(client, "list_desk_requests");
  expect(rest.text).toContain("1 request waiting");
  expect(rest.text).not.toContain("Is my opening strong enough?");
  await client.close();
});

test("Polish sends the highlighted passage, and the rewordings come back as suggestions", async ({ page }) => {
  await stubWindowOpen(page);
  await signUp(page, "polish");
  await addCollege(page, "Northfield University");
  const pieceId = await addPiece(page, "Community");
  await essay(page).click();
  await page.keyboard.insertText("My robot sorted cans.");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("It was very good at it.");
  await waitSaved(page);
  const client = await connect(await makeConnector(page));

  await openAsk(page);
  const polish = panel(page).getByRole("button", { name: "Polish selection" });
  await expect(polish).toBeDisabled();

  // Highlight the second paragraph: the panel points at it.
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+Home");
  await expect(panel(page).getByTestId("pointing")).toContainText("It was very good at it.");
  await askBox(page).fill("Make it less plain.");
  await expect(polish).toBeEnabled();
  await polish.click();

  const item = requests(page).filter({ hasText: "Make it less plain." });
  await expect(item.getByLabel("Highlighted passage")).toContainText("It was very good at it.");
  await expect(item).toContainText("Waiting for Claude");
  // Sending clears the pointer.
  await expect(panel(page).getByTestId("pointing")).toHaveCount(0);
  expect(await opened(page)).toEqual([]);

  const list = await call(client, "list_desk_requests");
  expect(list.text).toContain("(kind: polish)");
  expect(list.text).toContain('"""\nIt was very good at it.\n"""');
  expect(list.text).toContain("What the student wants: Make it less plain.");
  const id = list.text.match(REQUEST_ID)![1];

  // The route the listing describes: rewordings as suggestions on that passage, then a summary.
  const s = await call(client, "suggest_edits", {
    piece_id: pieceId,
    edits: [
      { find: "It was very good at it.", replace_with: "It never missed a can.", reason: "Concrete." },
      { find: "It was very good at it.", replace_with: "It sorted faster than I could.", reason: "Shows it." },
    ],
  });
  expect(s.isError).toBe(false);
  expect(s.text).toContain("2 suggestions added");
  expect((await call(client, "answer_request", { request_id: id, answer: "Two rewordings are waiting in your essay." })).isError).toBe(false);

  await expect(item).toContainText("Two rewordings are waiting in your essay.", { timeout: 15_000 });
  await expect(item).toContainText("accept the one you like");
  await client.close();
});

test("dismiss withdraws a request, Clear deletes the thread, and the assistant choice is remembered", async ({ page }) => {
  await stubWindowOpen(page);
  await signUp(page, "askdismiss");
  await addCollege(page, "Northfield University");
  await addPiece(page, "Short answer");
  await write(page, "A short answer about robots.");
  const client = await connect(await makeConnector(page));
  await openAsk(page);

  await panel(page).getByLabel("Answer with").selectOption("chatgpt");
  await askBox(page).fill("Too long?");
  await panel(page).getByRole("button", { name: "Ask ChatGPT" }).click();
  await expect(requests(page)).toHaveCount(1);
  expect(await opened(page)).toEqual([]);
  await askBox(page).fill("Too plain?");
  await panel(page).getByRole("button", { name: "Ask ChatGPT" }).click();
  await expect(requests(page)).toHaveCount(2);

  // Dismissing takes it off the panel and out of the assistant's queue.
  await requests(page).filter({ hasText: "Too long?" }).getByRole("button", { name: "Dismiss" }).click();
  await expect(requests(page)).toHaveCount(1);
  await expect(requests(page)).toContainText("Too plain?");
  const list = await call(client, "list_desk_requests");
  expect(list.text).toContain("1 request waiting");
  expect(list.text).not.toContain("Too long?");

  // Still gone after a reload, and ChatGPT is still the choice.
  await page.reload();
  await openAsk(page);
  await expect(requests(page)).toHaveCount(1);
  await expect(panel(page).getByRole("button", { name: "Ask ChatGPT" })).toBeVisible();

  // Clear deletes the whole thread.
  await panel(page).getByRole("button", { name: "Clear", exact: true }).click();
  await panel(page).getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(requests(page)).toHaveCount(0);
  await expect(panel(page).getByRole("group", { name: "Question ideas" })).toBeVisible();
  expect((await call(client, "list_desk_requests")).text).toContain("Nothing is waiting");
  await client.close();
});
