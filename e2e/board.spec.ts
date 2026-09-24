import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, essay, signUp, waitSaved } from "./helpers";

/** A YYYY-MM-DD date `n` days from today (UTC, as the server counts days). */
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Sets the open piece's status; the change saves just after. */
async function setStatus(page: Page, status: string) {
  await page.getByLabel("Status", { exact: true }).selectOption(status);
  await page.waitForTimeout(500);
}

/** A summary tile's big number. */
const tileValue = (page: Page, id: string) => page.getByTestId(`tile-${id}`).locator("dd").first();

test("the tiles count colleges, submitted pieces and words, and show the next deadline still owed", async ({ page }) => {
  await signUp(page, "tiles");
  await addCollege(page, "Northfield University", { deadline: inDays(10) });
  await addPiece(page, "Why Northfield?");
  await setStatus(page, "submitted");
  await addCollege(page, "Southfield College", { deadline: inDays(40) });
  await addPiece(page, "Community");
  await essay(page).click();
  await page.keyboard.type("one two three four five");
  await waitSaved(page);
  await page.waitForTimeout(1500); // the word count is stored just after the save

  // Statuses and counts are written in the background: reload until they have landed.
  await expect(async () => {
    await page.goto("/desk");
    await expect(tileValue(page, "words")).toHaveText("5", { timeout: 1000 });
    await expect(tileValue(page, "pieces")).toHaveText("1/2", { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await expect(tileValue(page, "colleges")).toHaveText("2");
  // Northfield is due sooner, but everything for it is sent.
  const next = page.getByTestId("tile-next");
  await expect(next).toContainText("Southfield College");
  await expect(next).toContainText(/(39|40) days left/);
  await expect(next).not.toContainText("Northfield");
  await expect(page.getByTestId("tile-colleges")).toContainText("1 fully submitted");
});

test("the deadlines table orders by due, sinks a submitted college and opens the first unfinished piece", async ({ page }) => {
  await signUp(page, "deadlines");
  await addCollege(page, "Late College", { deadline: "2030-12-01" });
  const early = await addCollege(page, "Early College", { deadline: "2030-10-15" });
  await addPiece(page, "Finished answer");
  await setStatus(page, "final");
  await page.goto(`/desk/college/${early}`);
  const open = await addPiece(page, "Open answer");
  await addCollege(page, "Done College", { deadline: "2030-10-01" });
  await addPiece(page, "Done essay");
  await setStatus(page, "submitted");

  const table = page.getByRole("table", { name: "Deadlines" });
  const earlyLink = table.getByRole("link", { name: "Early College", exact: true });
  await expect(async () => {
    await page.goto("/desk");
    expect(await table.getByRole("rowheader").allTextContents()).toEqual(["Early College", "Late College", "Done College"]);
    // "Finished answer" is final, so the college opens on the piece still to write.
    expect(await earlyLink.getAttribute("href")).toContain(open);
  }).toPass({ timeout: 20_000 });

  await expect(table.getByRole("row").filter({ hasText: "Early College" })).toContainText("0/2 submitted");
  await expect(table.getByRole("row").filter({ hasText: "Late College" })).toContainText("No pieces");
  // A college with no pieces opens its page, where pieces are added.
  await expect(table.getByRole("link", { name: "Late College", exact: true })).toHaveAttribute("href", /\/desk\/college\//);

  await earlyLink.click();
  await expect(page).toHaveURL(new RegExp(open));
  await expect(essay(page)).toBeVisible();

  await page.goto("/desk");
  await table.getByRole("link", { name: "Details for Late College" }).click();
  await expect(page.getByRole("heading", { name: "Late College", level: 1 })).toBeVisible();
});

test("the money table shows catalog averages for a known college, and the college page sums up odds and cost", async ({ page }) => {
  await signUp(page, "money");
  // A real college from the public College Scorecard catalog (published figures, no personal data).
  await addCollege(page, "Massachusetts Institute of Technology");
  const strategy = page.getByRole("region", { name: "Strategy" });
  // No AI estimate yet: the published admission rate stands in, and it is under 20%.
  await expect(strategy).toContainText("Reach");
  await expect(strategy).toContainText("Average acceptance rate");
  await expect(strategy).toContainText(/\$\d{1,3},\d{3}/);
  await expect(strategy.getByRole("link", { name: /All colleges by odds/ })).toHaveAttribute("href", "/desk/strategy");

  await addCollege(page, "Northfield University");
  await page.goto("/desk");
  const money = page.getByRole("table", { name: "Money" });
  const known = money.getByRole("row").filter({ hasText: "Massachusetts Institute of Technology" });
  await expect(known).toContainText(/\$\d{1,3},\d{3}/);
  await expect(known).toContainText("avg");
  await expect(money.getByRole("row").filter({ hasText: "Northfield University" })).toContainText("Not in the college catalog");
  // Colleges with a figure come first, cheapest net first.
  await expect(money.getByRole("rowheader")).toHaveText(["Massachusetts Institute of Technology", "Northfield University"]);
});
