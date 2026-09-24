import { expect, test, type Browser, type Page } from "@playwright/test";
import { addCollege, addPiece, apiClient, essay, expectEssay, expectEssayContains, signUp, suggestLog, waitSaved } from "./helpers";

/** The student makes a share link in Settings and returns its URL. */
async function makeLink(page: Page, opts: { role: "suggest" | "view" | "edit"; label?: string; password?: string }) {
  const back = page.url();
  await page.goto("/desk/settings");
  if (opts.label) await page.getByLabel("Who is it for?").fill(opts.label);
  await page.getByLabel("They can").selectOption(opts.role);
  if (opts.password) await page.getByLabel("Password (optional)").fill(opts.password);
  await page.getByRole("button", { name: "Make a share link" }).click();
  const url = await page.getByRole("textbox", { name: "Share link" }).inputValue();
  await page.goto(back);
  return url;
}

/** A parent, in their own browser, opens the link and types their name. */
async function join(browser: Browser, url: string, name: string, password?: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByLabel("Your name").fill(name);
  if (password) await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Open the desk" }).click();
  await expect(page).toHaveURL(/\/shared\//);
  return page;
}

async function openShared(parent: Page, title: string) {
  await parent.getByRole("link", { name: new RegExp(title) }).first().click();
  await expect(essay(parent)).toBeVisible();
}

/** A student with one piece containing `text`. */
async function studentWith(page: Page, tag: string, text: string) {
  await signUp(page, tag);
  await addCollege(page, "Share College");
  await addPiece(page, "Shared essay");
  if (text) {
    await essay(page).click();
    await page.keyboard.insertText(text);
    await waitSaved(page);
  }
}

const suggestions = (p: Page) => p.getByTestId("suggestion");

test("a parent suggests, the student sees it live and accepts it", async ({ page, browser }) => {
  await studentWith(page, "sugg", "The cat sat.");
  const url = await makeLink(page, { role: "suggest", label: "Mom" });
  const mom = await join(browser, url, "Mom");
  await openShared(mom, "Shared essay");
  await expectEssay(mom, "The cat sat.");

  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" Quietly.");
  // Her text is a suggestion, not an edit.
  await expect(mom.locator(".sugg-ins"), await suggestLog(mom)).toHaveText(" Quietly.");

  // The student sees it without reloading, and accepts it.
  await expect(suggestions(page)).toHaveCount(1);
  await expect(suggestions(page)).toContainText("Mom");
  await expect(page.locator(".sugg-ins")).toHaveText(" Quietly.");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "The cat sat. Quietly.");
  await waitSaved(page);
  await expectEssay(mom, "The cat sat. Quietly.");
  await expect(mom.locator(".sugg-ins")).toHaveCount(0);
});

test("replace, delete and decline; the student's text only changes on accept", async ({ page, browser }) => {
  await studentWith(page, "replace", "The cat sat.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Dad");
  await openShared(mom, "Shared essay");
  await essay(mom).click();

  // Select "cat" and type "dog".
  await mom.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await mom.keyboard.press("ArrowRight");
  for (let i = 0; i < 3; i++) await mom.keyboard.press("Shift+ArrowRight");
  await mom.keyboard.type("dog");
  // Backspace "sat" at the end (three presses make one suggestion).
  await mom.keyboard.press("Control+End");
  await mom.keyboard.press("ArrowLeft");
  for (let i = 0; i < 3; i++) await mom.keyboard.press("Backspace");

  await expect(suggestions(page)).toHaveCount(2);
  await expect(suggestions(page).nth(0)).toContainText("Replace “cat” with “dog”");
  await expect(suggestions(page).nth(1), await suggestLog(mom)).toContainText("Delete “sat”");
  await expectEssay(page, "The cat sat.");

  await suggestions(page).nth(0).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "The dog sat.");
  await suggestions(page).nth(0).getByRole("button", { name: "Decline" }).click();
  await expect(suggestions(page)).toHaveCount(0);
  await expectEssay(page, "The dog sat.");
  // Undo the decline: it comes back.
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(suggestions(page)).toHaveCount(1);
});

test("suggesting into an empty piece, then accepting it", async ({ page, browser }) => {
  await studentWith(page, "emptysugg", "");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.type("Start here");
  await expect(mom.locator(".sugg-ins")).toHaveText("Start here");
  await expect(suggestions(page)).toHaveCount(1);
  await expect(page.locator(".sugg-ins")).toHaveText("Start here");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "Start here");
  await waitSaved(page);
  await page.reload();
  await expectEssay(page, "Start here");
});

test("suggesting while the student types elsewhere: the suggestion stays whole", async ({ page, browser }) => {
  await studentWith(page, "busy", "One. Two.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await mom.keyboard.press("ArrowRight"); // after "One."

  await essay(page).click();
  await page.keyboard.press("Control+End");
  const typing = (async () => {
    for (const ch of " Three. Four. Five.") {
      await page.keyboard.type(ch);
      await page.waitForTimeout(40);
    }
  })();
  for (const ch of " Really.") {
    await mom.keyboard.type(ch);
    await mom.waitForTimeout(55);
  }
  await typing;
  await waitSaved(page);
  await expect(mom.locator(".sugg-ins")).toHaveText(" Really.");
  await expectEssayContains(page, "One. Two. Three. Four. Five.");
  await expectEssayContains(mom, "Three. Four. Five.");
  await expect(suggestions(page)).toHaveCount(1);
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "One. Really. Two. Three. Four. Five.");
});

test("a suggestion made just before leaving or reloading is kept, and Ctrl+Z undoes a burst", async ({ page, browser }) => {
  await studentWith(page, "sugreload", "Hello.");
  const mom = await join(browser, await makeLink(page, { role: "suggest" }), "Mom");
  await openShared(mom, "Shared essay");
  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" World");
  await mom.reload(); // no waiting
  await expect(essay(mom)).toBeVisible();
  await expect(mom.locator(".sugg-ins")).toHaveText(" World");
  await expect(suggestions(page)).toHaveCount(1);

  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.waitForTimeout(1200);
  await mom.keyboard.type(" again");
  await expect(mom.locator(".sugg-ins")).toHaveText(" World again");
  await mom.keyboard.press("Control+z");
  await expect(mom.locator(".sugg-ins")).toHaveText(" World");
  await expect(page.locator(".sugg-ins")).toHaveText(" World");
});

test("read-only links can't change anything", async ({ page, browser }) => {
  await studentWith(page, "viewonly", "Read me.");
  const reader = await join(browser, await makeLink(page, { role: "view" }), "Grandpa");
  await openShared(reader, "Shared essay");
  await expectEssay(reader, "Read me.");
  await essay(reader).click();
  await reader.keyboard.type("scribble");
  await reader.keyboard.press("Backspace");
  await expectEssay(reader, "Read me.");
  await expect(reader.locator(".sugg-ins")).toHaveCount(0);
  await page.reload();
  await expectEssay(page, "Read me.");
  await expect(suggestions(page)).toHaveCount(0);
});

test("passwords are checked, and revoking a link cuts access", async ({ page, browser }) => {
  await studentWith(page, "revoke", "Private.");
  const url = await makeLink(page, { role: "suggest", label: "Coach", password: "sesame-42" });

  const ctx = await browser.newContext();
  const wrong = await ctx.newPage();
  await wrong.goto(url);
  await wrong.getByLabel("Your name").fill("Coach");
  await wrong.getByLabel("Password").fill("nope-nope");
  await wrong.getByRole("button", { name: "Open the desk" }).click();
  await expect(wrong.getByText("Wrong password.")).toBeVisible();

  const coach = await join(browser, url, "Coach", "sesame-42");
  const deskUrl = coach.url();
  await openShared(coach, "Shared essay");
  const pieceUrl = coach.url();

  await page.goto("/desk/settings");
  const links = page.getByRole("list", { name: "Share links" });
  await expect(links).toContainText("Joined: Coach");
  await links.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke" }).click();
  await expect(links).toHaveCount(0);

  for (const u of [deskUrl, pieceUrl]) {
    const res = await coach.goto(u);
    expect(res?.status()).toBe(404);
  }
  await coach.goto(url);
  await expect(coach.getByText("This link doesn't work")).toBeVisible();
});

test("a suggester can't write the text, change a piece's settings or resolve suggestions; an editor's bad edit can't break the piece", async ({
  page,
}) => {
  await studentWith(page, "direct", "Mine.");
  const url = await makeLink(page, { role: "suggest" });
  const editUrl = await makeLink(page, { role: "edit" });
  const token = url.split("/join/")[1];
  const pieceId = page.url().split("/").pop()!;
  await page.goto(`/desk/piece/${pieceId}`);

  const api = apiClient();
  const { error: e1 } = await api.auth.signInAnonymously();
  expect(e1).toBeNull();
  const { data: joined } = await api.rpc("join_desk", { token, link_password: "", name: "Sneaky" });
  expect((joined as { ok: boolean }).ok).toBe(true);

  // Can read the piece...
  const { data: rows } = await api.from("pieces").select("id").eq("id", pieceId);
  expect(rows).toHaveLength(1);
  // ...but can't write its text...
  const { error: w1 } = await api.from("piece_updates").insert({ piece_id: pieceId, client_id: "x", update: "AAA=" });
  expect(w1).not.toBeNull();
  // ...change its fields or resolve suggestions.
  const { data: upd } = await api.from("pieces").update({ title: "hacked" }).eq("id", pieceId).select("id");
  expect(upd ?? []).toHaveLength(0);
  const sid = crypto.randomUUID();
  const { error: w2 } = await api.from("suggestions").insert({
    id: sid,
    piece_id: pieceId,
    author_name: "Sneaky",
    kind: "insert",
    anchor_from: "AA==",
    body: "x",
  });
  expect(w2).toBeNull();
  const { error: w3 } = await api.from("suggestions").update({ status: "accepted" }).eq("id", sid);
  expect(w3).not.toBeNull();
  // And can't pose as someone else.
  const { error: w4 } = await api.from("suggestions").insert({
    id: crypto.randomUUID(),
    piece_id: pieceId,
    author_id: "00000000-0000-0000-0000-000000000000",
    kind: "insert",
    anchor_from: "AA==",
  });
  expect(w4).not.toBeNull();

  // Someone on an edit link writes the text directly; a malformed edit is skipped, not fatal.
  const editor = apiClient();
  expect((await editor.auth.signInAnonymously()).error).toBeNull();
  const { data: joinedEdit } = await editor.rpc("join_desk", { token: editUrl.split("/join/")[1], link_password: "", name: "Editor" });
  expect((joinedEdit as { ok: boolean }).ok).toBe(true);
  const { error: w5 } = await editor.from("piece_updates").insert({ piece_id: pieceId, client_id: "y", update: "AAA=" });
  expect(w5).toBeNull();

  await page.reload();
  await expectEssay(page, "Mine.");
});

test("two tabs of the student edit live", async ({ page, context }) => {
  await studentWith(page, "twotabs", "Start.");
  const other = await context.newPage();
  await other.goto(page.url());
  await expectEssay(other, "Start.");
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" From one.");
  await essay(other).click();
  await other.keyboard.press("Control+Home");
  await other.keyboard.type("Two says hi. ");
  await expectEssay(page, "Two says hi. Start. From one.");
  await expectEssay(other, "Two says hi. Start. From one.");
  // Each sees the other's caret.
  await expect(page.locator(".collaboration-carets__label")).toHaveCount(1);
});

test("people who can edit switch between Editing and Suggesting, suggesters only suggest, and the student can suggest too", async ({
  page,
  browser,
}) => {
  await studentWith(page, "modes", "Start.");
  const dad = await join(browser, await makeLink(page, { role: "suggest", label: "Dad" }), "Dad");
  await openShared(dad, "Shared essay");
  await expect(dad.getByText("Your changes show as suggestions")).toBeVisible();
  await expect(dad.getByRole("radiogroup", { name: "Mode" })).toHaveCount(0);

  const mom = await join(browser, await makeLink(page, { role: "edit" }), "Mom");
  await openShared(mom, "Shared essay");

  // Mom starts in Suggesting; in Editing her words go straight into the text.
  await expect(mom.getByRole("radio", { name: "Suggesting" })).toHaveAttribute("aria-checked", "true");
  await mom.getByRole("radio", { name: "Editing" }).click();
  await essay(mom).click();
  await mom.keyboard.press("Control+End");
  await mom.keyboard.type(" Mom was here.");
  await expectEssay(page, "Start. Mom was here.");
  await expect(suggestions(page)).toHaveCount(0);

  // The student switches to Suggesting, suggests, and accepts their own suggestion.
  await page.getByRole("radio", { name: "Suggesting" }).click();
  await essay(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Maybe.");
  await expect(suggestions(page)).toHaveCount(1);
  await expectEssay(page, "Start. Mom was here.");
  await suggestions(page).getByRole("button", { name: "Accept" }).click();
  await expectEssay(page, "Start. Mom was here. Maybe.");
  await expectEssay(mom, "Start. Mom was here. Maybe.");

  // The student lets Dad edit too: his link changes for him at once.
  await page.goto("/desk/settings");
  await page.getByRole("list", { name: "Share links" }).getByLabel("What Dad can do").selectOption("edit");
  await expect(async () => {
    await dad.reload();
    await expect(dad.getByRole("radiogroup", { name: "Mode" })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
});
