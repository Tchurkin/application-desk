import { strToU8, zipSync } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { filledName, fileKind, formatSize, noteTitle, uploadsAsNote } from "./files";
import { docxText } from "./docx";
import { fillPdf, pdfFields, pdfText, renderPdf } from "./pdf";

/** The fields of a PDF that isn't protected. */
async function fieldsOf(bytes: Uint8Array) {
  const fields = await pdfFields(bytes);
  if (fields === "protected") throw new Error("protected");
  return fields;
}

/** A one-page school form for Testy, with one field of each kind. */
async function schoolForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawText("Records release for Testy Student", { x: 50, y: 740, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  const form = doc.getForm();
  form.createTextField("student_name").addToPage(page, { x: 50, y: 680, width: 300, height: 20 });
  const grad = form.createTextField("grad_year");
  grad.setMaxLength(4);
  grad.addToPage(page, { x: 50, y: 650, width: 60, height: 20 });
  form.createCheckBox("waive").addToPage(page, { x: 50, y: 620, width: 12, height: 12 });
  const access = form.createRadioGroup("access");
  access.addOptionToPage("Waive", page, { x: 50, y: 590, width: 12, height: 12 });
  access.addOptionToPage("Keep", page, { x: 80, y: 590, width: 12, height: 12 });
  const term = form.createDropdown("term");
  term.addOptions(["Fall", "Spring"]);
  term.addToPage(page, { x: 50, y: 560, width: 100, height: 20 });
  form.createTextField("locked").enableReadOnly();
  return doc.save();
}

describe("pdf forms", () => {
  it("lists the fields with their kinds and choices", async () => {
    const fields = await fieldsOf(await schoolForm());
    expect(fields.map((f) => [f.name, f.kind])).toEqual([
      ["student_name", "text"],
      ["grad_year", "text"],
      ["waive", "checkbox"],
      ["access", "radio"],
      ["term", "dropdown"],
      ["locked", "text"],
    ]);
    expect(fields.find((f) => f.name === "access")?.options).toEqual(["Waive", "Keep"]);
    expect(fields.find((f) => f.name === "grad_year")?.maxLength).toBe(4);
  });

  it("fills what it can and says why it skipped the rest", async () => {
    const r = await fillPdf(await schoolForm(), {
      student_name: "Testy Student",
      grad_year: "20277",
      waive: true,
      access: "waive",
      term: "Spring",
      locked: "x",
      nope: "x",
    });
    expect(r.filled).toEqual(["student_name", "waive", "access", "term"]);
    expect(r.skipped.map((s) => s.name)).toEqual(["grad_year", "locked", "nope"]);
    expect(r.skipped[0].why).toContain("4 characters");

    const back = Object.fromEntries((await fieldsOf(r.bytes)).map((f) => [f.name, f.value]));
    expect(back).toMatchObject({ student_name: "Testy Student", waive: "checked", access: "Waive", term: "Spring", grad_year: "" });
  });

  it("won't take a choice the field doesn't offer, or text the form can't show", async () => {
    const r = await fillPdf(await schoolForm(), { access: "Maybe", term: "Summer", waive: "perhaps", student_name: "Testy 🎓" });
    expect(r.filled).toEqual([]);
    expect(r.skipped.find((s) => s.name === "access")?.why).toContain("Waive, Keep");
    expect(r.skipped.find((s) => s.name === "student_name")?.why).toContain("characters");
    expect((await fieldsOf(r.bytes)).find((f) => f.name === "student_name")?.value).toBe("");
  });

  it("reads and fills an empty rich-text field (which pdf-lib can't read)", async () => {
    const doc = await PDFDocument.load(await schoolForm());
    doc.getForm().getTextField("student_name").enableRichFormatting();
    const bytes = await doc.save();
    expect((await fieldsOf(bytes)).find((f) => f.name === "student_name")?.value).toBe("");
    expect((await fillPdf(bytes, { student_name: "Testy Student" })).filled).toEqual(["student_name"]);
  });

  it("says so for a protected PDF", () => {
    expect(renderPdf("locked.pdf", "protected", ["Some text"])).toContain("protected against changes");
  });

  it("reads the text, and renders fields for the counselor", async () => {
    const bytes = await schoolForm();
    const pages = await pdfText(bytes);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain("Records release for Testy Student");
    const out = renderPdf("release.pdf", await fieldsOf(bytes), pages);
    expect(out).toContain('- "access" (radio; one of: Waive | Keep)');
    expect(out).toContain("--- Page 1 ---");
    expect(renderPdf("scan.pdf", [], ["", ""])).toContain("no fillable fields");
  });
});

describe("files", () => {
  it("reads a Word document's paragraphs", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>Testy &amp; the robot</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:body></w:document>';
    expect(docxText(zipSync({ "word/document.xml": strToU8(xml) }))).toBe("Testy & the robot\nLine two");
  });

  it("knows kinds, names and sizes", () => {
    expect(fileKind({ name: "Waiver.PDF", mime: "" })).toBe("pdf");
    expect(fileKind({ name: "me.jpg", mime: "image/jpeg" })).toBe("image");
    expect(fileKind({ name: "resume.docx", mime: "" })).toBe("word");
    expect(fileKind({ name: "x.zip", mime: "application/zip" })).toBe("other");
    expect(filledName("Waiver.pdf")).toBe("Waiver (filled).pdf");
    expect(filledName("Waiver.pdf", "Signed copy")).toBe("Signed copy.pdf");
    expect(noteTitle("My story.md")).toBe("My story");
    expect(uploadsAsNote({ name: "a.md", type: "", size: 100 })).toBe(true);
    expect(uploadsAsNote({ name: "a.md", type: "", size: 50_000 })).toBe(false);
    expect(uploadsAsNote({ name: "a.pdf", type: "application/pdf", size: 100 })).toBe(false);
    expect(formatSize(1536)).toBe("2 KB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
