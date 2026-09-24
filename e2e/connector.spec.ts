import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, essay, expectEssay, signUp, waitSaved } from "./helpers";

async function write(page: Page, text: string) {
  await essay(page).click();
  await page.keyboard.insertText(text);
  await waitSaved(page);
}

async function makeConnector(page: Page) {
  await page.goto("/desk/settings");
  await page.getByLabel("Assistant").selectOption("Claude");
  await page.getByRole("button", { name: "Make a connector link" }).click();
  return page.getByRole("textbox", { name: "Connector link" }).inputValue();
}

async function connect(url: string) {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { text: r.content.map((c) => c.text ?? "").join("\n"), isError: !!r.isError };
}

test("Claude reads the desk and its edits arrive as suggestions the student accepts", async ({ page }) => {
  await signUp(page, "connector");
  await addCollege(page, "Open College", { deadline: "2030-11-01" });
  const pieceId = await addPiece(page, "Why us", 100);
  await write(page, "I like robots. I built one.");

  await page.goto("/desk");
  const details = page.locator("details", { hasText: "Add a college" });
  await details.locator("summary").click();
  await details.getByLabel("College", { exact: true }).fill("Strict College");
  await details.getByLabel("This college forbids AI help with drafting").check();
  await details.getByRole("button", { name: "Add college" }).click();
  await expect(page.getByRole("heading", { name: "Strict College", level: 1 })).toBeVisible();
  const strictId = await addPiece(page, "Strict essay");
  await write(page, "Some text.");

  const url = await makeConnector(page);
  const client = await connect(url);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(["list_my_desk", "read_piece", "suggest_edits"]);

  const desk = await call(client, "list_my_desk");
  expect(desk.text).toContain("Open College");
  expect(desk.text).toContain(`piece_id: ${pieceId}`);
  expect(desk.text).toMatch(/Strict College.*NO AI DRAFTING/);

  const read = await call(client, "read_piece", { piece_id: pieceId });
  expect(read.text).toContain("I like robots. I built one.");
  expect(read.text).toContain("Limit: 100 words");

  const res = await call(client, "suggest_edits", {
    piece_id: pieceId,
    edits: [
      { find: "robots", replace_with: "robotics", reason: "More precise." },
      { find: "not in the essay", replace_with: "x", reason: "Test." },
    ],
  });
  expect(res.isError).toBe(false);
  expect(res.text).toContain("1 suggestion added");
  expect(res.text).toContain("2. not added");

  // The college that bars AI drafting refuses edits.
  const strict = await call(client, "suggest_edits", {
    piece_id: strictId,
    edits: [{ find: "Some", replace_with: "Any", reason: "Test." }],
  });
  expect(strict.isError).toBe(true);
  expect(strict.text).toContain("does not allow AI help with drafting");

  // The student sees Claude's suggestion, with its reason, and accepts it.
  await page.goto(`/desk/piece/${pieceId}`);
  const s = page.getByTestId("suggestion");
  await expect(s).toHaveCount(1);
  await expect(s).toContainText("Claude · AI");
  await expect(s).toContainText("Replace “robots” with “robotics”");
  await expect(s).toContainText("Why: More precise.");
  await expectEssay(page, "I like robots. I built one.");
  await s.getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "I like robotics. I built one.");
  await waitSaved(page);

  // Claude sees the accepted text.
  const after = await call(client, "read_piece", { piece_id: pieceId });
  expect(after.text).toContain("I like robotics. I built one.");

  // Revoking the link disconnects it.
  await page.goto("/desk/settings");
  const list = page.getByRole("list", { name: "Connector links" });
  await expect(list).toContainText("Last used");
  await list.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(list).toHaveCount(0);
  const gone = await call(client, "list_my_desk");
  expect(gone.isError).toBe(true);
  expect(gone.text).toContain("not valid");
  await client.close();
});

test("a made-up connector link opens nothing", async ({ request }) => {
  const res = await request.post("/api/mcp/not-a-real-token-at-all-000000", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_my_desk", arguments: {} } },
  });
  const body = await res.text();
  expect(body).not.toContain("Colleges");
});
