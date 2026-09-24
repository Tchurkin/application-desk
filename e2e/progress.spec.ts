import { expect, test, type Page } from "@playwright/test";
import { addCollege, addPiece, signUp } from "./helpers";

/** Set the open piece's status from its page, and give the save a moment (as desk.spec does). */
async function setStatus(page: Page, status: string) {
  await page.getByLabel("Status", { exact: true }).selectOption(status);
  await page.waitForTimeout(500);
}

const lanes = (page: Page) => page.getByRole("list", { name: "Colleges by urgency" });
const lane = (page: Page, name: string) => lanes(page).getByRole("listitem", { name, exact: true });
/** A piece's chip on its college's own lane. */
const chip = (page: Page, college: string, title: string) =>
  lane(page, college).getByRole("slider", { name: title, exact: true });
const moved = (page: Page) => page.getByRole("status").filter({ hasText: "Moved" });

/** The colleges' lanes, top to bottom. */
function laneOrder(page: Page) {
  return lanes(page)
    .locator(":scope > li")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
}

test("each college gets a lane, most urgent first, with each piece at its stage", async ({ page }) => {
  await signUp(page, "progress-lanes");
  const north = await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?", 250);
  await page.goto(`/desk/college/${north}`);
  await addPiece(page, "Activity essay");
  await setStatus(page, "needs_review");
  await page.goto(`/desk/college/${north}`);
  await addPiece(page, "Community essay");
  await setStatus(page, "needs_review");

  // The closest deadline, but everything is in: it goes to the bottom.
  await addCollege(page, "Eastbrook College", { deadline: "2030-10-15" });
  await addPiece(page, "Eastbrook short answer");
  await setStatus(page, "submitted");

  await addCollege(page, "Westmoor Institute");
  await addPiece(page, "Westmoor essay");
  await setStatus(page, "final");

  await page.goto("/desk/progress");
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Westmoor Institute", "Eastbrook College"]);

  await expect(chip(page, "Northfield University", "Why Northfield?")).toHaveAttribute("aria-valuetext", "Not started");
  // Two pieces at one stage share a chip.
  const shared = lane(page, "Northfield University").getByRole("link", { name: /^2 pieces, Needs review/ });
  await expect(shared).toHaveText("2 pieces");
  await expect(chip(page, "Westmoor Institute", "Westmoor essay")).toHaveAttribute("aria-valuetext", "Final");
  await expect(chip(page, "Eastbrook College", "Eastbrook short answer")).toHaveAttribute("aria-valuetext", "Submitted");
  await expect(lane(page, "Northfield University")).toContainText("Nov 1");
  await expect(lane(page, "Westmoor Institute")).toContainText("no date");

  // Folding a college out gives each piece its own lane, labeled with its word count.
  await lane(page, "Northfield University").getByRole("button", { name: "Show pieces of Northfield University" }).click();
  const pieces = lane(page, "Northfield University").getByRole("list", { name: "Pieces of Northfield University" });
  await expect(pieces.getByRole("slider", { name: /^Why Northfield\?/ })).toHaveText("0/250w");
  const activity = pieces.getByRole("slider", { name: /^Activity essay/ });
  await expect(activity).toHaveText("0w");
  await expect(activity).toHaveAttribute("aria-valuetext", "Needs review");

  // Moving one of the pair splits the shared chip, and the fold is remembered.
  await activity.focus();
  await page.keyboard.press("ArrowRight");
  await expect(activity).toHaveAttribute("aria-valuetext", "Final");
  await expect(chip(page, "Northfield University", "Community essay")).toHaveAttribute("aria-valuetext", "Needs review");
  await expect(chip(page, "Northfield University", "Activity essay")).toHaveAttribute("aria-valuetext", "Final");
  await expect(moved(page)).toContainText("to Final");
  await page.reload();
  await expect(activity).toHaveAttribute("aria-valuetext", "Final");
});

test("the arrow keys move a piece a stage, it sticks, and clicking the chip opens it", async ({ page }) => {
  await signUp(page, "progress-keys");
  await page.goto("/desk/progress");
  await expect(page.getByText("No pieces of writing yet.")).toBeVisible();

  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  const id = await addPiece(page, "Why Northfield?", 250);

  await page.goto("/desk/progress");
  const piece = chip(page, "Northfield University", "Why Northfield?");
  await expect(piece).toHaveAttribute("aria-valuetext", "Not started");
  await piece.focus();
  await page.keyboard.press("ArrowRight");
  await expect(piece).toHaveAttribute("aria-valuetext", "Drafting");
  await expect(piece).toBeFocused();
  await expect(moved(page)).toHaveText("Moved “Why Northfield?” to Drafting.");
  // At the first stage ArrowLeft goes back; it never goes past either end.
  await page.keyboard.press("ArrowLeft");
  await expect(piece).toHaveAttribute("aria-valuetext", "Not started");
  await page.keyboard.press("ArrowLeft");
  await expect(piece).toHaveAttribute("aria-valuetext", "Not started");
  await page.keyboard.press("ArrowRight");
  await expect(moved(page)).toHaveText("Moved “Why Northfield?” to Drafting.");

  await page.reload();
  await expect(piece).toHaveAttribute("aria-valuetext", "Drafting");

  await piece.click();
  await expect(page).toHaveURL(new RegExp(`/desk/(piece|write)/${id}`));
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue("drafting");
});

test("dragging a chip changes its stage without opening the piece", async ({ page }) => {
  await signUp(page, "progress-drag");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?");

  await page.goto("/desk/progress");
  const piece = chip(page, "Northfield University", "Why Northfield?");
  const track = lane(page, "Northfield University").getByRole("group", { name: "Northfield University stages" });
  const from = (await piece.boundingBox())!;
  const lanebox = (await track.boundingBox())!;
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  // Into the fourth fifth of the lane: Final.
  await page.mouse.move(lanebox.x + lanebox.width * 0.7, y, { steps: 10 });
  await page.mouse.up();
  await expect(piece).toHaveAttribute("aria-valuetext", "Final");
  await expect(moved(page)).toContainText("to Final");
  await expect(page).toHaveURL(/\/desk\/progress$/);

  await page.reload();
  await expect(piece).toHaveAttribute("aria-valuetext", "Final");
});

test("submitting a college's last piece sinks it below the rest", async ({ page }) => {
  await signUp(page, "progress-sink");
  await addCollege(page, "Eastbrook College", { deadline: "2030-10-15" });
  await addPiece(page, "Eastbrook short answer");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?");

  await page.goto("/desk/progress");
  await expect.poll(() => laneOrder(page)).toEqual(["Eastbrook College", "Northfield University"]);
  const piece = chip(page, "Eastbrook College", "Eastbrook short answer");
  await piece.focus();
  await page.keyboard.press("End");
  await expect(piece).toHaveAttribute("aria-valuetext", "Submitted");
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Eastbrook College"]);
  await expect(moved(page)).toContainText("to Submitted");

  await page.reload();
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Eastbrook College"]);
});

test("the columns view lists pieces under their stage and moves them too", async ({ page }) => {
  await signUp(page, "progress-columns");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?", 250);
  await setStatus(page, "drafting");

  await page.goto("/desk/progress");
  await page.getByRole("navigation", { name: "Progress view" }).getByRole("link", { name: "Columns" }).click();
  await expect(page).toHaveURL(/\/desk\/progress\?view=columns$/);
  const card = page.getByRole("slider", { name: "Why Northfield?, Northfield University" });
  await expect(page.getByRole("list", { name: "Drafting" }).getByRole("slider")).toHaveCount(1);
  await expect(card).toContainText("0/250w");
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("list", { name: "Needs review" }).getByRole("slider", { name: /^Why Northfield\?/ })).toBeVisible();
  await expect(card).toBeFocused();
  await expect(moved(page)).toContainText("to Needs review");
});
