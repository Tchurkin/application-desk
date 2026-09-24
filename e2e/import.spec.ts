import { strToU8, zipSync } from "fflate";
import { expect, test } from "@playwright/test";
import { addCollege, addPiece, expectEssay, signUp } from "./helpers";

/** A minimal Word file: paragraphs as [text, style?]. */
function docx(paras: [string, string?][]): Uint8Array {
  const body = paras
    .map(([t, style]) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) });
}

test("a Google Drive folder download lands on the right pieces, and a combined doc splits at its headings", async ({ page }) => {
  await signUp(page, "import");
  await addCollege(page, "Northfield University");
  const whyId = await addPiece(page, "Why Northfield?");

  // What Google Drive gives for "Download" on a folder: a .zip of Word files.
  const zip = zipSync({
    "Essays/Northfield University/Why Northfield.docx": docx([["I want to build robots here."]]),
    "Essays/Personal statement.docx": docx([["The summer I fixed a bike."]]),
    "Essays/All essays.docx": docx([["My essays", "Title"], ["Community", "Heading2"], ["I help at the library."], ["Activity", "Heading2"], ["Robotics captain."]]),
  });

  await page.goto("/desk");
  await page.getByRole("link", { name: "Import essays" }).click();
  await expect(page).toHaveURL(/\/desk\/import$/);
  await page.getByLabel("Upload essay files").setInputFiles({ name: "Essays.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });

  const rows = page.getByTestId("import-row");
  await expect(rows).toHaveCount(3);
  // Matched by its folder and title to the college's piece.
  await expect(page.getByLabel("College for Why Northfield").locator("option:checked")).toHaveText("Northfield University");
  await expect(page.getByLabel("Piece for Why Northfield").locator("option:checked")).toHaveText("Why Northfield?");
  await expect(page.getByLabel("College for Personal statement").locator("option:checked")).toHaveText("Independent (no college)");

  // One doc holding two essays becomes two pieces.
  await page.getByRole("button", { name: "Split into 2 pieces at its headings" }).click();
  await expect(rows).toHaveCount(4);
  await expect(page.getByLabel("Import Community")).toBeChecked();
  await expect(page.getByLabel("Import Activity")).toBeChecked();

  await page.getByRole("button", { name: "Import 4 pieces" }).click();
  await expect(page.getByTestId("import-result")).toContainText("Imported 4 pieces");

  await page.goto(`/desk/piece/${whyId}`);
  await expectEssay(page, "I want to build robots here.");
  await page.goto("/desk");
  // Independent pieces show as links with their status beside the title.
  for (const title of ["Personal statement", "Community", "Activity"]) {
    await expect(page.getByRole("link", { name: new RegExp(`^${title}\\b`) }).first()).toBeVisible();
  }
});
