import { expect, test, type Locator, type Page } from "@playwright/test";
import { addCollege, addPiece, signUp, submitCollege } from "./helpers";

/** Set the open piece's status from its page, and give the save a moment (as desk.spec does). */
async function setStatus(page: Page, status: string) {
  await page.getByLabel("Status", { exact: true }).selectOption(status);
  await page.waitForTimeout(500);
}

const lanes = (page: Page) => page.getByRole("list", { name: "Colleges", exact: true });
const lane = (page: Page, name: string) => lanes(page).getByRole("listitem", { name, exact: true });
/** A piece's card in its college's lane. */
const card = (page: Page, college: string, title: string) => lane(page, college).getByRole("slider", { name: title, exact: true });
const moved = (page: Page) => page.getByRole("status").filter({ hasText: "Moved" });

/** The colleges' lanes, top to bottom. */
function laneOrder(page: Page) {
  return lanes(page)
    .locator(":scope > li")
    .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
}

test("each college gets a lane, most urgent first, unfolded, with each piece in its stage's column", async ({ page }) => {
  await signUp(page, "board-lanes");
  const north = await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?", 250);
  await page.goto(`/desk/college/${north}`);
  await addPiece(page, "Activity essay");
  await setStatus(page, "needs_review");
  await page.goto(`/desk/college/${north}`);
  await addPiece(page, "Community essay");
  await setStatus(page, "needs_review");

  // The closest deadline, but its application is in: it goes to the bottom.
  await addCollege(page, "Eastbrook College", { deadline: "2030-10-15" });
  await addPiece(page, "Eastbrook short answer");
  await setStatus(page, "final");
  await submitCollege(page, "Eastbrook College");

  await addCollege(page, "Westmoor Institute");
  await addPiece(page, "Westmoor essay");
  await setStatus(page, "final");

  await page.goto("/desk");
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Westmoor Institute", "Eastbrook College"]);

  const north_ = lane(page, "Northfield University");
  await expect(north_).toContainText("Common App");
  await expect(north_).toContainText("0/3 final");
  await expect(north_.getByTitle("Regular Decision")).toHaveText("RD");
  await expect(north_).toContainText("Nov 1");
  await expect(lane(page, "Westmoor Institute")).toContainText("no deadline");
  await expect(card(page, "Northfield University", "Why Northfield?")).toHaveAttribute("aria-valuetext", "Not started");
  await expect(card(page, "Northfield University", "Why Northfield?")).toContainText("0/250w");
  await expect(north_.getByRole("list", { name: "Needs review" }).getByRole("slider")).toHaveCount(2);
  await expect(card(page, "Westmoor Institute", "Westmoor essay")).toHaveAttribute("aria-valuetext", "Final");
  // A submitted college is folded, with its date; unfolded, its pieces sit in Final.
  const east = lane(page, "Eastbrook College");
  await expect(east.getByTestId("submitted-tag")).toContainText("Submitted");
  const eastFold = east.getByRole("button", { name: "Pieces of Eastbrook College" });
  await expect(eastFold).toHaveAttribute("aria-expanded", "false");
  await expect(east.getByRole("group", { name: "Eastbrook College stages" })).toHaveCount(0);
  await eastFold.click();
  // Its pieces went in with it: they open, but no longer move.
  await expect(east.getByRole("list", { name: "Final" }).getByRole("link", { name: "Eastbrook short answer", exact: true })).toBeVisible();
  await expect(east.getByRole("slider")).toHaveCount(0);

  // Folding a college is remembered; Unfold all brings every card back.
  await north_.getByRole("button", { name: "Pieces of Northfield University" }).click();
  await expect(north_.getByRole("slider")).toHaveCount(0);
  await expect(north_.getByRole("img")).toHaveAttribute("aria-label", "1 Not started, 2 Needs review");
  await page.reload();
  await expect(north_.getByRole("slider")).toHaveCount(0);
  await page.getByRole("button", { name: "Unfold all" }).click();
  await expect(north_.getByRole("slider")).toHaveCount(3);
});

test("the arrow keys move a piece a stage, it sticks, and clicking the card opens it", async ({ page }) => {
  await signUp(page, "board-keys");
  await page.goto("/desk");
  await expect(page.getByText("Nothing on the board yet.")).toBeVisible();

  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  const id = await addPiece(page, "Why Northfield?", 250);

  await page.goto("/desk");
  const piece = card(page, "Northfield University", "Why Northfield?");
  await expect(piece).toHaveAttribute("aria-valuetext", "Not started");
  await piece.focus();
  await page.keyboard.press("ArrowRight");
  await expect(piece).toHaveAttribute("aria-valuetext", "Drafting");
  await expect(piece).toBeFocused();
  await expect(moved(page)).toHaveText("Moved “Why Northfield?” to Drafting.");
  await expect(lane(page, "Northfield University").getByRole("list", { name: "Drafting" }).getByRole("slider")).toHaveCount(1);
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

test("dragging a card to another column changes its stage without opening the piece", async ({ page }) => {
  await signUp(page, "board-drag");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?");

  await page.goto("/desk");
  const piece = card(page, "Northfield University", "Why Northfield?");
  const track = lane(page, "Northfield University").getByRole("group", { name: "Northfield University stages" });
  const from = (await piece.boundingBox())!;
  const box = (await track.boundingBox())!;
  const y = from.y + from.height / 2;
  await page.mouse.move(from.x + from.width / 2, y);
  await page.mouse.down();
  // Into the last of four columns: Final.
  await page.mouse.move(box.x + box.width * 0.9, y, { steps: 10 });
  await page.mouse.up();
  await expect(piece).toHaveAttribute("aria-valuetext", "Final");
  await expect(moved(page)).toContainText("to Final");
  await expect(page).toHaveURL(/\/desk$/);

  await page.reload();
  await expect(piece).toHaveAttribute("aria-valuetext", "Final");
});

test("a college's application is submitted at once: it folds to the bottom, and undoing brings it back", async ({ page }) => {
  await signUp(page, "board-sink");
  await addCollege(page, "Eastbrook College", { deadline: "2030-10-15" });
  await addPiece(page, "Eastbrook short answer");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addPiece(page, "Why Northfield?");

  await page.goto("/desk");
  await expect.poll(() => laneOrder(page)).toEqual(["Eastbrook College", "Northfield University"]);
  // A piece goes as far as Final on its own; End takes it there.
  const piece = card(page, "Eastbrook College", "Eastbrook short answer");
  await piece.focus();
  await page.keyboard.press("End");
  await expect(piece).toHaveAttribute("aria-valuetext", "Final");
  await expect(lane(page, "Eastbrook College")).toContainText("1/1 final");

  // The whole application goes in with one button.
  const east = lane(page, "Eastbrook College");
  await east.getByRole("button", { name: "Mark as done", exact: true }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Its piece is marked submitted");
  await confirm.getByRole("button", { name: "Mark as done", exact: true }).click();
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Eastbrook College"]);
  await expect(east.getByTestId("submitted-tag")).toBeVisible();
  await expect(east.getByRole("button", { name: "Pieces of Eastbrook College" })).toHaveAttribute("aria-expanded", "false");
  await expect(east.getByRole("group", { name: "Eastbrook College stages" })).toHaveCount(0);

  await page.reload();
  await expect.poll(() => laneOrder(page)).toEqual(["Northfield University", "Eastbrook College"]);
  await expect(east.getByTestId("submitted-tag")).toBeVisible();

  // Undo: back in its place, its piece at Final.
  await east.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => laneOrder(page)).toEqual(["Eastbrook College", "Northfield University"]);
  await expect(card(page, "Eastbrook College", "Eastbrook short answer")).toHaveAttribute("aria-valuetext", "Final");
  await page.reload();
  await expect(card(page, "Eastbrook College", "Eastbrook short answer")).toHaveAttribute("aria-valuetext", "Final");
  // The old Progress page is the board now.
  await page.goto("/desk/progress");
  await expect(page).toHaveURL(/\/desk$/);
});

/** Which of the eight recommender colors a chip has. */
const colorOf = async (chip: Locator) => (await chip.getAttribute("class"))?.match(/\brec-(\d)\b/)?.[1];

test("recommenders: added by hand, each in a color of their own, their letters tracked beside each college", async ({ page }) => {
  await signUp(page, "letters");
  await addCollege(page, "Northfield University", { deadline: "2030-11-01" });
  await addCollege(page, "Southfield College", { deadline: "2030-12-01" });
  await page.goto("/desk");
  const north = lane(page, "Northfield University");
  const south = lane(page, "Southfield College");

  // Someone new, straight from a college.
  await north.getByRole("button", { name: "Add a letter for Northfield University" }).click();
  const adding = page.getByRole("dialog", { name: "Add a letter for Northfield University" });
  await adding.getByLabel("Recommender's name").fill("Ms. Rivera");
  await adding.getByLabel("Their role").fill("Physics teacher");
  await adding.getByRole("button", { name: "Add", exact: true }).click();
  const rivera = north.getByRole("button", { name: /^Ms\. Rivera:/ });
  await expect(rivera).toHaveAccessibleName("Ms. Rivera: Not asked yet");

  // Someone else from the bar, then given a letter for another college.
  const bar = page.getByTestId("recommenders");
  await bar.getByRole("button", { name: "+ Add recommender" }).click();
  const another = page.getByRole("dialog", { name: "Add a recommender" });
  await another.getByLabel("Recommender's name").fill("Mr. Chen");
  await another.getByRole("button", { name: "Add recommender" }).click();
  await south.getByRole("button", { name: "Add a letter for Southfield College" }).click();
  await page.getByRole("dialog", { name: "Add a letter for Southfield College" }).getByRole("button", { name: /Mr\. Chen/ }).click();
  const chen = south.getByRole("button", { name: /^Mr\. Chen:/ });
  await expect(chen).toBeVisible();
  expect(await colorOf(chen)).toBeDefined();
  expect(await colorOf(chen)).not.toBe(await colorOf(rivera));

  // Sent: it sticks.
  await rivera.click();
  await page.getByRole("dialog", { name: "Ms. Rivera's letter for Northfield University" }).getByRole("radio", { name: "Submitted" }).click();
  await expect(rivera).toHaveAccessibleName("Ms. Rivera: Submitted");
  await page.reload();
  await expect(rivera).toHaveAccessibleName("Ms. Rivera: Submitted");
  await expect(bar.getByRole("button", { name: /^Ms\. Rivera,/ })).toHaveAccessibleName("Ms. Rivera, 1 letter, 1 sent");

  // Removing a recommender takes their letters with them.
  await bar.getByRole("button", { name: /^Mr\. Chen,/ }).click();
  const edit = page.getByRole("dialog", { name: "Edit Mr. Chen" });
  await edit.getByRole("button", { name: "Remove Mr. Chen" }).click();
  await edit.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(chen).toHaveCount(0);
  await page.reload();
  await expect(chen).toHaveCount(0);
  await expect(south.getByRole("group", { name: "Letters for Southfield College" })).toContainText("none yet");
});
