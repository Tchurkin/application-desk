import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, apiClient, codeSignIn, essay, signUp, submitCollege, waitSaved } from "./helpers";

test("a student sets up a college, writes a piece, and it survives a reload", async ({ page }) => {
  await signUp(page, "basic");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?", 5);

  await essay(page).click();
  await page.keyboard.type("One two three four five six");
  await expect(page.getByTestId("count")).toContainText("6 / 5 words");
  await expect(page.getByTestId("count")).toContainText("1 over");
  await waitSaved(page);

  await page.reload();
  await expect(essay(page)).toHaveText("One two three four five six");

  // Notes are kept outside the essay and never counted.
  // Notes open above the writing.
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page.getByLabel("Notes").fill("Mention the robotics lab");
  await expect(page.getByTestId("count")).toContainText("6 / 5 words");

  await page.goto("/desk");
  const board = page.getByRole("list", { name: "Colleges", exact: true });
  // Typing moved the piece from "Not started" to "Drafting".
  await expect(board.getByRole("slider", { name: "Why Northfield?" })).toHaveAttribute("aria-valuetext", "Drafting");
});

test("a letter typed just before a reload is not lost", async ({ page }) => {
  await signUp(page, "reload");
  await addCollege(page, "Reload College");
  await addPiece(page, "Fast");
  await essay(page).click();
  await page.keyboard.type("abcdefgh");
  await page.reload(); // no waiting for the save
  await expect(essay(page)).toHaveText("abcdefgh");
  await waitSaved(page);
  await page.reload();
  await expect(essay(page)).toHaveText("abcdefgh");
});

test("leaving a piece a moment after typing keeps the text", async ({ page }) => {
  await signUp(page, "leave");
  const college = await addCollege(page, "Leave College");
  await addPiece(page, "Short answer");
  await essay(page).click();
  await page.keyboard.type("typed then left");
  await page.getByRole("link", { name: "Leave College" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/college/${college}`));
  await page.getByRole("link", { name: /Short answer/ }).click();
  await expect(essay(page)).toHaveText("typed then left");
});

test("the board is home, and Write reopens the piece you were last on", async ({ page }) => {
  await signUp(page, "reopen");
  await addCollege(page, "Reopen College");
  const id = await addPiece(page, "Last one");
  await page.goto("/");
  await expect(page).toHaveURL(/\/desk$/);
  const nav = page.getByRole("navigation", { name: "Desk" });
  await expect(nav.getByRole("link").first()).toHaveText("Board");
  await nav.getByRole("link", { name: "Write" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/piece/${id}`));
});

test("an empty piece opens, reloads and stays empty", async ({ page }) => {
  await signUp(page, "empty");
  await addCollege(page, "Empty College");
  await addPiece(page, "Nothing yet");
  await page.reload();
  await expect(essay(page)).toHaveText("");
  await expect(page.getByTestId("sync-status")).not.toHaveText(/Can't reach/);
});

test("the board orders by deadline and sinks fully submitted colleges", async ({ page }) => {
  await signUp(page, "board");
  await addCollege(page, "Late College", { deadline: "2030-12-01" });
  await addCollege(page, "Early College", { deadline: "2030-10-15" });
  await addCollege(page, "Done College", { deadline: "2030-10-01" });
  await addPiece(page, "Done essay");
  await submitCollege(page, "Done College");
  // Virginia vs Virginia Tech: pieces attach by id, never by a name prefix.
  await addCollege(page, "Virginia", { deadline: "2030-11-01" });
  await addCollege(page, "Virginia Tech", { deadline: "2030-11-01" });
  await addPiece(page, "Tech essay");

  await page.goto("/desk");
  const board = page.getByRole("list", { name: "Colleges", exact: true });
  const names = await board.locator(":scope > li").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  expect(names).toEqual(["Early College", "Virginia", "Virginia Tech", "Late College", "Done College"]);
  await expect(board.getByRole("listitem", { name: "Virginia", exact: true })).toContainText("No pieces yet");
  await expect(board.getByRole("listitem", { name: "Virginia Tech", exact: true }).getByRole("slider", { name: "Tech essay" })).toBeVisible();
});

test("warns past 20 Common App colleges and suggests the no-letter ones", async ({ page }) => {
  await signUp(page, "cap");
  for (let i = 1; i <= 21; i++) await addCollege(page, `Cap College ${i}`, { letters: i !== 7 });
  await page.goto("/desk");
  const alert = page.getByRole("alert").filter({ hasText: "Common App" });
  await expect(alert).toContainText("21 colleges use the Common App");
  await expect(alert).toContainText("Cap College 7");
});

test("history keeps the first save, compares a version with now side by side, and restores it", async ({ page }) => {
  await signUp(page, "history");
  await addCollege(page, "History College");
  await addPiece(page, "Drafts");
  await essay(page).click();
  await page.keyboard.insertText("first draft");
  await waitSaved(page);
  await page.waitForTimeout(1500);
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("second draft");
  await waitSaved(page);
  // Leave, come back, keep writing: the text the last session ended with is kept.
  await page.goto("/desk");
  await page.getByRole("list", { name: "Colleges", exact: true }).getByRole("slider", { name: "Drafts" }).click();
  await essay(page).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(", continued");
  await waitSaved(page);
  await page.waitForTimeout(1500); // the version is written just after the save

  await page.getByRole("button", { name: "History", exact: true }).click();
  const list = page.getByRole("list", { name: "Saved versions" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await list.getByRole("button").first().click();

  // Split screen: the version on the left, the piece now on the right, with what changed marked.
  const compare = page.getByTestId("version-compare");
  await expect(compare.getByTestId("version-preview")).toHaveText("second draft");
  await expect(compare.getByTestId("version-now")).toHaveText("second draft, continued");
  await expect(compare.getByTestId("version-now").locator("ins")).toContainText("continued");
  await expect(compare.getByTestId("version-preview").locator("del")).toHaveText("draft");
  await expect(compare.getByTestId("diff-counts")).toContainText("1 word taken out, 2 added");

  // Step back to the older version, then restore it.
  await compare.getByRole("button", { name: "Older version" }).click();
  await expect(compare.getByTestId("version-preview")).toHaveText("first draft");
  await expect(compare.getByRole("button", { name: "Older version" })).toBeDisabled();
  await compare.getByRole("button", { name: "Restore this version" }).click();
  await expect(compare).toHaveCount(0);
  await expect(essay(page)).toHaveText("first draft");
  // What was there before restoring is a version too.
  await expect.poll(() => list.getByRole("button").count()).toBeGreaterThanOrEqual(3);
});

test("deleting a piece leaves no ghost, even with a write in flight", async ({ page }) => {
  await signUp(page, "delete");
  const college = await addCollege(page, "Delete College");
  const id = await addPiece(page, "Doomed");
  await essay(page).click();
  await page.keyboard.type("going away");
  await page.getByRole("tablist", { name: "Pieces" }).getByRole("button", { name: "Delete “Doomed”" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/college/${college}`));
  await page.waitForTimeout(2000);
  await expect(page.getByRole("link", { name: /Doomed/ })).toHaveCount(0);
  const res = await page.goto(`/desk/piece/${id}`);
  expect(res?.status()).toBe(404);
});

test("row-level security: one student can't read or write another's desk", async ({ page }) => {
  const owner = await signUp(page, "owner");
  await addCollege(page, "Private College");
  const pieceId = await addPiece(page, "Private essay");
  await essay(page).click();
  await page.keyboard.type("secret words");
  await waitSaved(page);

  const intruder = apiClient();
  const creds = { email: `intruder${Date.now()}@example.test`, password: "another-password-1" };
  const { error: signUpError } = await intruder.auth.signUp(creds);
  expect(signUpError).toBeNull();
  for (const table of ["pieces", "colleges", "piece_updates", "piece_versions", "desks", "profiles"]) {
    const { data } = await intruder.from(table).select("*");
    const leaked = (data ?? []).filter((r) => JSON.stringify(r).includes("secret") || JSON.stringify(r).includes(owner.email));
    expect(leaked, table).toHaveLength(0);
  }
  const { error: writeError } = await intruder
    .from("piece_updates")
    .insert({ piece_id: pieceId, client_id: "x", update: "AAA=" });
  expect(writeError).not.toBeNull();
  const { error: compactError } = await intruder.rpc("compact_piece", {
    p: pieceId,
    state: "",
    through_id: 1e9,
    cutoff: new Date().toISOString(),
  });
  expect(compactError).not.toBeNull();

  await page.reload();
  await expect(essay(page)).toHaveText("secret words");
});

test("delete my data removes the account", async ({ page }) => {
  const s = await signUp(page, "gdpr");
  await addCollege(page, "Gone College");
  await page.goto("/desk/settings/account");
  await page.getByLabel('Type "delete" to confirm').fill("delete");
  await page.getByRole("button", { name: "Delete everything" }).click();
  await expect(page).toHaveURL(/\/\?deleted=1|\/login/);
  await page.goto("/login");
  await page.getByLabel("Email").fill(s.email);
  if (codeSignIn) {
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "There's no desk with that email yet" })).toBeVisible();
  } else {
    await page.getByLabel("Password").fill(s.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Invalid login credentials/i)).toBeVisible();
  }
});

test("on a wide screen the Write page stays put: only its columns scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await signUp(page, "scrolling");
  await addCollege(page, "Scroll College");
  await addPiece(page, "Long one");
  await essay(page).click();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.insertText(`Paragraph ${i}, long enough to take up a line of the essay.`);
    await page.keyboard.press("Enter");
  }
  // The essay's column scrolled to follow the caret; the page and the workspace itself did not.
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("[data-write-scroll]")!.scrollTop)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLElement>("[data-write-scroll]")!.parentElement!.scrollTop)).toBe(0);
  await expect(page.getByRole("navigation", { name: "Desk" })).toBeInViewport();
});

/** A piece's own fields (not its text) saved: the update request came back. */
const savedPiece = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/rest/v1/pieces") && r.request().method() === "PATCH" && r.ok());

test("a piece gets a due date of its own, shown on the board", async ({ page }) => {
  await signUp(page, "due");
  const lanes = page.getByRole("list", { name: "Colleges", exact: true });
  const due = page.getByLabel("Due", { exact: true });

  // An independent piece: its date is its lane's.
  await page.goto("/desk/add/piece");
  await page.getByLabel("Title").fill("Personal statement");
  await page.getByRole("button", { name: "Add piece" }).click();
  await expect(page).toHaveURL(/\/desk\/piece\//);
  await expect(essay(page)).toBeVisible();
  await expect(due).toHaveValue("");
  await Promise.all([savedPiece(page), due.fill("2030-10-15")]);
  await page.reload();
  await expect(due).toHaveValue("2030-10-15");
  await page.goto("/desk");
  await expect(lanes.getByRole("listitem", { name: "Personal statement", exact: true })).toContainText("Oct 15");

  // A college's piece shows its own date on its card when it isn't the college deadline.
  await addCollege(page, "Testy College", { deadline: "2030-11-01" });
  await addPiece(page, "Why us?");
  await Promise.all([savedPiece(page), due.fill("2030-10-20")]);
  await page.goto("/desk");
  const lane = lanes.getByRole("listitem", { name: "Testy College", exact: true });
  await expect(lane).toContainText("Nov 1");
  await expect(lane.getByRole("slider", { name: "Why us?", exact: true })).toContainText("Oct 20");
});

test("the margin folds away and the writing takes its space; the page itself never scrolls", async ({ page }) => {
  await signUp(page, "margin");
  await addCollege(page, "Fold College");
  await addPiece(page, "Long one");
  await essay(page).click();
  await page.keyboard.insertText(Array.from({ length: 80 }, (_, i) => `Paragraph ${i + 1} of Testy's essay.`).join("\n"));
  await waitSaved(page);

  const margin = page.getByRole("complementary", { name: "Margin" });
  const before = (await essay(page).boundingBox())!.width;
  await margin.getByRole("button", { name: "Fold the margin away" }).click();
  await expect(margin.locator("#essay-margin")).toBeHidden();
  await expect.poll(async () => (await essay(page).boundingBox())!.width).toBeGreaterThan(before + 200);
  // Remembered.
  await page.reload();
  await expect(margin.getByRole("button", { name: /^Show the margin/ })).toBeVisible();
  await margin.getByRole("button", { name: /^Show the margin/ }).click();
  await expect(margin.getByRole("button", { name: "Fold the margin away" })).toBeVisible();

  // Scrolling on past the end of the essay doesn't move the page (it used to jump, then snap back).
  await page.evaluate(() => {
    (window as unknown as { maxY: number }).maxY = 0;
    window.addEventListener("scroll", () => {
      const w = window as unknown as { maxY: number };
      w.maxY = Math.max(w.maxY, window.scrollY);
    });
  });
  const box = (await essay(page).boundingBox())!;
  await page.mouse.move(box.x + 40, Math.min(box.y + 200, 600));
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 900);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { maxY: number }).maxY)).toBe(0);
  expect(await page.evaluate(() => document.querySelector("[data-write-scroll]")!.scrollTop)).toBeGreaterThan(0);
});
