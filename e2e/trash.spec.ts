import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { addCollege, addPiece, essay, expectEssay, signUp, waitSaved } from "./helpers";

test("deleted pieces and colleges wait in the Trash, and come back whole", async ({ page }) => {
  await signUp(page, "trash");
  const college = await addCollege(page, "Trash College");
  const id = await addPiece(page, "Keep me");
  await essay(page).click();
  await page.keyboard.type("words worth keeping");
  await waitSaved(page);

  // A piece, deleted from its tab.
  await page.getByRole("tablist", { name: "Pieces" }).getByRole("button", { name: "Delete “Keep me”" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("It goes to the Trash");
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/college/${college}`));

  await page.goto("/desk/settings/trash");
  const piece = page.getByTestId("trash-item").filter({ hasText: "Keep me" });
  await expect(piece).toContainText("piece for Trash College");
  await expect(piece).toContainText("by you");
  await piece.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is back" })).toContainText("“Keep me” is back.");
  await page.getByRole("link", { name: "Open it" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/piece/${id}`));
  await expectEssay(page, "words worth keeping");

  // A whole college, with its piece.
  await page.goto(`/desk/college/${college}`);
  await page.getByRole("button", { name: "Delete college" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/desk$/);
  await page.goto("/desk/settings/trash");
  const whole = page.getByTestId("trash-item").filter({ hasText: "Trash College" });
  await expect(whole).toContainText("college, 1 piece");
  await whole.getByRole("button", { name: "Restore" }).click();
  await expect(page.getByRole("status").filter({ hasText: "is back" })).toBeVisible();
  await expect(page.getByTestId("trash-item")).toHaveCount(0);
  await page.goto(`/desk/piece/${id}`);
  await expectEssay(page, "words worth keeping");

  // Deleted for good, it's gone.
  await page.getByRole("tablist", { name: "Pieces" }).getByRole("button", { name: "Delete “Keep me”" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(new RegExp(`/desk/college/${college}`));
  await page.goto("/desk/settings/trash");
  await page.getByTestId("trash-item").getByRole("button", { name: "Delete forever" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByText("The Trash is empty.")).toBeVisible();
  const gone = await page.goto(`/desk/piece/${id}`);
  expect(gone?.status()).toBe(404);
});

test("download all my writing: every piece as a Word file, and the whole desk", async ({ page }) => {
  await signUp(page, "export");
  await addCollege(page, "Export College");
  await addPiece(page, "Why us?");
  await essay(page).click();
  await page.keyboard.type("Robots all the way down.");
  await waitSaved(page);

  await page.goto("/desk/settings/account");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download all my writing" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Margin writing \d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
  expect(Object.keys(files)).toContain("Export College/Why us.docx");
  const word = strFromU8(unzipSync(files["Export College/Why us.docx"])["word/document.xml"]);
  expect(word).toContain("Robots all the way down.");
  const everything = JSON.parse(strFromU8(files["everything.json"]));
  expect(everything.colleges.map((c: { name: string }) => c.name)).toEqual(["Export College"]);
  expect(everything.pieces[0]).toMatchObject({ title: "Why us?", text: "Robots all the way down." });
  expect(everything.pieces[0]).not.toHaveProperty("doc_state");
});
