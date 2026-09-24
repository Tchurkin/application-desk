import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { guessCollege, guessPiece, paragraphsText, planRows, splitAtHeadings, type DeskCollege, type DeskPiece } from "./plan";
import { docxParagraphs, fileSources, googleDocSources, textParagraphs, type GDoc } from "./sources";

/** A minimal .docx: paragraphs as [text, style?]. */
function docx(paras: [string, string?][]): Uint8Array {
  const body = paras
    .map(([t, style]) => {
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
      const runs = t
        .split("\t")
        .map((part) => `<w:r><w:t xml:space="preserve">${part.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</w:t></w:r>`)
        .join("<w:r><w:tab/></w:r>");
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;
  return zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(xml) });
}

const COLLEGES: DeskCollege[] = [
  { id: "stan", name: "Stanford University" },
  { id: "mit", name: "Massachusetts Institute of Technology" },
  { id: "ucla", name: "University of California-Los Angeles" },
  { id: "unc", name: "University of North Carolina at Chapel Hill" },
  { id: "ncs", name: "North Carolina State University" },
];

const PIECES: DeskPiece[] = [
  { id: "p1", title: "Why Stanford?", college_id: "stan", word_count: 0 },
  { id: "p2", title: "Letter to your future roommate", college_id: "stan", word_count: 0 },
  { id: "p3", title: "Personal statement", college_id: null, word_count: 0 },
];

describe("reading documents", () => {
  it("reads a Word file's paragraphs, headings, tabs and special characters", () => {
    const paras = docxParagraphs(docx([["Why Stanford", "Heading1"], ["I like robots & code.\tReally."], [""], ["Café ✓"]]));
    expect(paras).toEqual([
      { text: "Why Stanford", heading: 1 },
      { text: "I like robots & code.\tReally.", heading: 0 },
      { text: "", heading: 0 },
      { text: "Café ✓", heading: 0 },
    ]);
  });

  it("reads a Drive folder download (.zip of Word files), keeping each file's folder", () => {
    const zip = zipSync({
      "Essays/Stanford - Why us.docx": docx([["I want to build things."]]),
      "Essays/MIT/Community.docx": docx([["My robotics team."]]),
      "Essays/notes.txt": strToU8("Remember deadlines"),
      "Essays/photo.png": new Uint8Array([1, 2, 3]),
    });
    const docs = fileSources("Essays.zip", zip, "z");
    expect(docs.map((d) => [d.title, d.from])).toEqual([
      ["Community", "Essays/MIT"],
      ["Stanford - Why us", "Essays"],
      ["notes", "Essays"],
    ]);
    expect(paragraphsText(docs[1].paragraphs)).toBe("I want to build things.");
  });

  it("refuses files it can't read, saying what to use", () => {
    expect(() => fileSources("essay.pdf", new Uint8Array([1]), "x")).toThrow(/\.docx/);
  });

  it("reads Markdown headings in text files", () => {
    expect(textParagraphs("# Why us\r\nBecause.")).toEqual([
      { text: "Why us", heading: 1 },
      { text: "Because.", heading: 0 },
    ]);
  });

  it("turns a Google Doc with tabs into one piece per tab, and a plain doc into one", () => {
    const para = (t: string, style = "NORMAL_TEXT") => ({ paragraph: { elements: [{ textRun: { content: `${t}\n` } }], paragraphStyle: { namedStyleType: style } } });
    const tabbed: GDoc = {
      title: "Stanford supplements",
      tabs: [
        { tabProperties: { tabId: "t1", title: "Why Stanford" }, documentTab: { body: { content: [para("Because.")] } } },
        {
          tabProperties: { tabId: "t2", title: "Roommate" },
          documentTab: { body: { content: [para("Dear roommate,"), { table: { tableRows: [{ tableCells: [{ content: [para("cell")] }] }] } }] } },
          childTabs: [{ tabProperties: { tabId: "t3", title: "Short answers" }, documentTab: { body: { content: [para("Answer", "HEADING_2")] } } }],
        },
      ],
    };
    const docs = googleDocSources(tabbed, "g");
    expect(docs.map((d) => [d.title, d.from])).toEqual([
      ["Why Stanford", "Stanford supplements"],
      ["Roommate", "Stanford supplements"],
      ["Short answers", "Stanford supplements"],
    ]);
    expect(paragraphsText(docs[1].paragraphs)).toBe("Dear roommate,\ncell");
    expect(docs[2].paragraphs[0]).toEqual({ text: "Answer", heading: 2 });

    const plain = googleDocSources({ title: "Personal statement", body: { content: [para("Once.")] } }, "p");
    expect(plain).toEqual([{ key: "p", title: "Personal statement", from: "", paragraphs: [{ text: "Once.", heading: 0 }] }]);
  });
});

describe("matching docs to the desk", () => {
  it("finds the college from the doc's name, its tab's doc, or its folder", () => {
    expect(guessCollege(["Stanford - Why us", ""], COLLEGES)).toBe("stan");
    expect(guessCollege(["Community", "Essays/MIT"], COLLEGES)).toBe("mit");
    expect(guessCollege(["UCLA PIQ 1"], COLLEGES)).toBe("ucla");
    expect(guessCollege(["Why UNC Chapel Hill"], COLLEGES)).toBe("unc");
    // Two Carolinas, and nothing saying which: no guess.
    expect(guessCollege(["North Carolina essay"], COLLEGES)).toBeNull();
    expect(guessCollege(["Personal statement"], COLLEGES)).toBeNull();
  });

  it("fills in the matching piece, each piece once", () => {
    expect(guessPiece("Why Stanford", "stan", PIECES)).toBe("p1");
    expect(guessPiece("Roommate letter", "stan", PIECES)).toBe("p2");
    expect(guessPiece("Personal Statement", null, PIECES)).toBe("p3");
    expect(guessPiece("Why Stanford", "stan", PIECES, new Set(["p1"]))).toBeNull();
    expect(guessPiece("Community", "stan", PIECES)).toBeNull();
  });

  it("plans rows: text, words, college and piece, and whether it can be split", () => {
    const [row] = planRows([{ key: "a", title: "Why Stanford", from: "Stanford supplements", paragraphs: [{ text: "I like it here.", heading: 0 }] }], COLLEGES, PIECES);
    expect(row).toMatchObject({ collegeId: "stan", pieceId: "p1", words: 4, include: true, parts: 0, text: "I like it here." });
    const [empty] = planRows([{ key: "b", title: "Blank", from: "", paragraphs: [{ text: "", heading: 0 }] }], COLLEGES, PIECES);
    expect(empty.include).toBe(false);
  });

  it("splits one long doc at its headings, keeping any intro with the first part", () => {
    const doc = {
      key: "d",
      title: "All my essays",
      from: "",
      paragraphs: [
        { text: "My college essays", heading: 1 },
        { text: "Why Stanford", heading: 2 },
        { text: "Because.", heading: 0 },
        { text: "Roommate", heading: 2 },
        { text: "Dear roommate,", heading: 0 },
      ],
    };
    const parts = splitAtHeadings(doc);
    // A single top heading isn't a split point; the level below, used twice, is.
    expect(parts.map((p) => p.title)).toEqual(["Why Stanford", "Roommate"]);
    expect(paragraphsText(parts[0].paragraphs)).toBe("My college essays\nBecause.");
    expect(parts[1].from).toBe("All my essays");
  });
});
