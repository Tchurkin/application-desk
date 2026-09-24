import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, essay, expectEssay, expectEssayContains, signUp, waitSaved } from "./helpers";

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
    // Arguments the tool's schema rejects can come back as a protocol error instead.
    return { text: (e as Error).message, isError: true };
  }
}

const LONG = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long rewrite that goes well past the old cap.`).join(" ");

test("suggestions of any length arrive for review, and the student accepts a long one", async ({ page }) => {
  await signUp(page, "connsugg");
  await addCollege(page, "Open College", { deadline: "2030-11-01" });
  const pieceId = await addPiece(page, "Why us", 1000);
  await write(page, "I like robots. I built one.");
  const client = await connect(await makeConnector(page));

  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(
    [
      "create_piece",
      "delete_college",
      "delete_piece",
      "edit_piece",
      "list_my_desk",
      "read_piece",
      "set_up_colleges",
      "suggest_edits",
      "update_college",
      "update_my_profile",
      "update_piece",
      "write_piece",
    ].sort(),
  );
  const read = await call(client, "read_piece", { piece_id: pieceId });
  expect(read.text).toContain("I like robots. I built one.");
  expect(read.text).toContain("Limit: 1000 words");

  const res = await call(client, "suggest_edits", {
    piece_id: pieceId,
    edits: [
      { find: "I like robots.", replace_with: LONG, reason: "A fuller opening." },
      { find: "not in the essay", replace_with: "x", reason: "Test." },
    ],
  });
  expect(res.isError).toBe(false);
  expect(res.text).toContain("1 suggestion added");
  expect(res.text).toContain("2. not added");

  await page.reload();
  const s = page.getByTestId("suggestion");
  await expect(s).toHaveCount(1);
  await expect(s).toContainText("Claude · AI");
  await expect(s).toContainText("Why: A fuller opening.");
  await s.getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, `${LONG} I built one.`);
  await waitSaved(page);
  await client.close();
});

test("the AI writes, edits and adds pieces directly; the old text stays in History", async ({ page }) => {
  await signUp(page, "connwrite");
  await addCollege(page, "Strict College");
  await page.getByLabel("This college doesn't allow AI help with drafting (tells Claude/ChatGPT)").check();
  await page.getByRole("button", { name: "Save details" }).click();
  const collegeUrl = page.url();
  const collegeId = collegeUrl.split("/").pop()!;
  const pieceId = await addPiece(page, "Supplement");
  await write(page, "My own first try.");
  const client = await connect(await makeConnector(page));

  // The college's AI policy is shown to the AI as information, not a block.
  const desk = await call(client, "list_my_desk");
  expect(desk.text).toMatch(/Strict College.*AI policy/);

  // The student has the piece open while the AI rewrites it: the new text arrives live.
  const w = await call(client, "write_piece", {
    piece_id: pieceId,
    text: "A drafted opening paragraph.\n\nA drafted second paragraph with more detail.",
  });
  expect(w.isError).toBe(false);
  expect(w.text).toContain("previous text is saved");
  await expectEssay(page, "A drafted opening paragraph.A drafted second paragraph with more detail.");

  const e = await call(client, "edit_piece", {
    piece_id: pieceId,
    edits: [
      { find: "A drafted opening paragraph.", replace_with: "An opening I will rewrite myself." },
      { find: "more detail.", insert_after: " " + LONG },
    ],
  });
  expect(e.isError).toBe(false);
  expect(e.text).toContain("Applied 2 edits");
  await expectEssayContains(page, "An opening I will rewrite myself.");
  await expectEssayContains(page, "Sentence 40 of a long rewrite");

  // History has the student's words from before the AI's first write.
  await page.getByRole("button", { name: /History/ }).click();
  const versions = page.getByRole("list", { name: "Saved versions" }).getByRole("button");
  await expect(versions.first()).toBeVisible();
  let found = false;
  for (let i = 0; i < (await versions.count()); i++) {
    await versions.nth(i).click();
    if ((await page.getByTestId("version-preview").innerText()).includes("My own first try.")) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);

  // A new supplemental with a first draft appears on the desk.
  const c = await call(client, "create_piece", {
    college_id: collegeId,
    title: "Why Strict?",
    prompt: "Why this college?",
    limit_value: 250,
    text: "Draft paragraph one.\nDraft paragraph two.",
  });
  expect(c.isError).toBe(false);
  const newId = c.text.match(/piece_id: ([0-9a-f-]{36})/)![1];
  await page.goto(collegeUrl);
  await expect(page.getByRole("link", { name: /Why Strict\?/ })).toBeVisible();
  await page.goto(`/desk/piece/${newId}`);
  await expectEssay(page, "Draft paragraph one.Draft paragraph two.");
  await client.close();
});

test("the AI sets up the whole desk from a list, without duplicates, and manages it", async ({ page }) => {
  await signUp(page, "connsetup");
  await page.goto("/desk/settings");
  const client = await connect(await makeConnector(page));

  const colleges = [
    {
      name: "Northfield University",
      app_system: "common_app",
      round: "EA",
      deadline: "2030-11-01",
      needs_letters: true,
      research: "Strong robotics program.",
      pieces: [
        { title: "Why Northfield?", prompt: "Why do you want to attend Northfield?", limit_value: 250 },
        { title: "Community", prompt: "Describe a community you belong to.", limit_kind: "chars", limit_value: 1500 },
      ],
    },
    {
      name: "Coastal Tech",
      app_system: "own_portal",
      round: "RD",
      deadline: "2031-01-05",
      needs_letters: false,
      pieces: [{ title: "Short answer", prompt: "What will you build?", limit_value: 100 }],
    },
  ];
  const first = await call(client, "set_up_colleges", { colleges });
  expect(first.isError).toBe(false);
  expect(first.text).toContain("Northfield University");
  expect(first.text).toContain("2 pieces added");

  // Again, with one more prompt: nothing duplicated, the new one added.
  colleges[1].pieces.push({ title: "Activity", prompt: "Tell us about an activity.", limit_value: 150 });
  const again = await call(client, "set_up_colleges", { colleges });
  expect(again.text).toContain("already on the desk");
  expect(again.text).toContain("1 piece added, 1 already there");

  await page.goto("/desk");
  const board = page.getByRole("list", { name: "Colleges by deadline" });
  await expect(board.locator("[data-college]")).toHaveCount(2);
  await expect(board.locator("[data-college]").first()).toContainText("Northfield University");
  await expect(board).toContainText("Why Northfield?");
  await expect(board).toContainText("Activity");

  const desk = await call(client, "list_my_desk");
  const northfield = desk.text.match(/Northfield University \[college_id: ([0-9a-f-]{36})\]/)![1];
  const activity = desk.text.match(/Activity \[piece_id: ([0-9a-f-]{36})\]/)![1];
  const why = desk.text.match(/Why Northfield\? \[piece_id: ([0-9a-f-]{36})\]/)![1];
  expect(desk.text).toContain("Prompt: Why do you want to attend Northfield?");

  expect((await call(client, "update_college", { college_id: northfield, deadline: "2030-10-15", round: "ED" })).isError).toBe(false);
  expect(
    (await call(client, "update_piece", { piece_id: why, prompt: "Why Northfield, specifically?", limit_value: 300, status: "drafting" })).isError,
  ).toBe(false);
  expect((await call(client, "delete_piece", { piece_id: activity })).isError).toBe(false);
  expect((await call(client, "update_my_profile", { about: "I build robots and run the school maker club." })).isError).toBe(false);

  await page.goto(`/desk/piece/${why}`);
  await expect(page.getByLabel("Prompt")).toHaveValue("Why Northfield, specifically?");
  await expect(page.getByLabel("Limit", { exact: true })).toHaveValue("300");
  await page.goto("/desk");
  await expect(board).not.toContainText("Activity");
  await expect(board.locator("[data-college]").first()).toContainText("Early Decision");
  await page.goto("/desk/settings");
  await expect(page.getByLabel("About you")).toHaveValue("I build robots and run the school maker club.");

  const bad = await call(client, "update_college", { college_id: northfield, deadline: "Nov 1" });
  expect(bad.isError).toBe(true);
  await client.close();
});

test("revoking a connector link disconnects it, and a made-up link opens nothing", async ({ page, request }) => {
  await signUp(page, "connrevoke");
  await addCollege(page, "Some College");
  await addPiece(page, "Piece");
  const client = await connect(await makeConnector(page));
  expect((await call(client, "list_my_desk")).isError).toBe(false);

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

  const res = await request.post("/api/mcp/not-a-real-token-at-all-000000", {
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_my_desk", arguments: {} } },
  });
  expect(await res.text()).not.toContain("Colleges");
});
