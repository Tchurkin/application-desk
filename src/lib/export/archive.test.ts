import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { docxParagraphs } from "@/lib/import/sources";
import { buildArchive, docx, INDEPENDENT_FOLDER, piecePaths, safeName } from "./archive";

describe("file names", () => {
  it("keeps names every system takes", () => {
    expect(safeName("Why Northfield?")).toBe("Why Northfield");
    expect(safeName('A: "the" <best> / worst|')).toBe("A the best worst");
    expect(safeName("   ")).toBe("Untitled");
    expect(safeName("x".repeat(200))).toHaveLength(80);
    expect(safeName("Ends with dots...")).toBe("Ends with dots");
  });

  it("puts each piece in its college's folder and never overwrites one with another", () => {
    const paths = piecePaths([
      { title: "Why us?", college: "Northfield University" },
      { title: "Why us", college: "Northfield University" },
      { title: "Personal statement", college: null },
      { title: "why US", college: "Northfield University" },
    ]);
    expect(paths).toEqual([
      "Northfield University/Why us.docx",
      "Northfield University/Why us (2).docx",
      `${INDEPENDENT_FOLDER}/Personal statement.docx`,
      "Northfield University/why US (3).docx",
    ]);
  });
});

describe("the Word file", () => {
  it("holds the title, prompt, every paragraph and the notes, escaped", () => {
    const bytes = docx({ title: "Why us?", prompt: "Why Northfield?", text: "I build robots.\n\nR&D <matters>.", notes: "Mention the lab" });
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    expect(strFromU8(files["word/document.xml"])).toContain("R&amp;D &lt;matters&gt;.");
    // It reads back the way the import reads any Word file.
    expect(docxParagraphs(bytes).map((p) => p.text)).toEqual([
      "Why us?",
      "Why Northfield?",
      "I build robots.",
      "",
      "R&D <matters>.",
      "Notes (not part of the essay)",
      "Mention the lab",
    ]);
  });
});

describe("the download", () => {
  it("has every piece, a README and the whole desk as JSON", () => {
    const zip = buildArchive({
      deskTitle: "Testy's desk",
      date: "2030-10-10",
      pieces: [
        { title: "Why us?", college: "Northfield University", prompt: "", notes: "", text: "Robots." },
        { title: "Personal statement", college: null, prompt: "", notes: "", text: "Hello." },
      ],
      data: { colleges: [{ name: "Northfield University" }] },
    });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual([
      `${INDEPENDENT_FOLDER}/Personal statement.docx`,
      "Northfield University/Why us.docx",
      "README.txt",
      "everything.json",
    ]);
    expect(JSON.parse(strFromU8(files["everything.json"]))).toEqual({ colleges: [{ name: "Northfield University" }] });
    expect(strFromU8(files["README.txt"])).toContain("Testy's desk");
  });
});
