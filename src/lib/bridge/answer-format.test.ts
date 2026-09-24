import { describe, expect, it } from "vitest";
import { parseAnswer, parseInline } from "./answer-format";

describe("parseInline", () => {
  it("finds bold, italic and code, and leaves the rest as text", () => {
    expect(parseInline("**Yes.** The *robot* line uses `find`.")).toEqual([
      { text: "Yes.", bold: true },
      { text: " The " },
      { text: "robot", italic: true },
      { text: " line uses " },
      { text: "find", code: true },
      { text: "." },
    ]);
    expect(parseInline("__also bold__")).toEqual([{ text: "also bold", bold: true }]);
  });

  it("doesn't mistake arithmetic or snake_case for emphasis", () => {
    expect(parseInline("2 * 3 * 4 and piece_id")).toEqual([{ text: "2 * 3 * 4 and piece_id" }]);
  });

  it("keeps markup-looking text as plain text (React renders it as text)", () => {
    expect(parseInline('<img src=x onerror="alert(1)">')).toEqual([{ text: '<img src=x onerror="alert(1)">' }]);
  });
});

describe("parseAnswer", () => {
  it("splits paragraphs on blank lines and keeps single line breaks", () => {
    expect(parseAnswer("First line\nsecond line\n\nNext paragraph")).toEqual([
      { kind: "p", lines: [[{ text: "First line" }], [{ text: "second line" }]] },
      { kind: "p", lines: [[{ text: "Next paragraph" }]] },
    ]);
  });

  it("reads bullet and numbered lists, with indented continuations", () => {
    const blocks = parseAnswer("Two things:\n- Keep the **first** line\n* Cut the last\n  sentence\n\n3. Third\n4) Fourth");
    expect(blocks).toEqual([
      { kind: "p", lines: [[{ text: "Two things:" }]] },
      {
        kind: "ul",
        items: [
          [{ text: "Keep the " }, { text: "first", bold: true }, { text: " line" }],
          [{ text: "Cut the last" }, { text: " " }, { text: "sentence" }],
        ],
      },
      { kind: "ol", start: 3, items: [[{ text: "Third" }], [{ text: "Fourth" }]] },
    ]);
  });

  it("reads quotes and headings, and drops horizontal rules", () => {
    expect(parseAnswer("## Verdict\n> It was very good at it.\n---\nDone.\r\n")).toEqual([
      { kind: "heading", spans: [{ text: "Verdict" }] },
      { kind: "quote", lines: [[{ text: "It was very good at it." }]] },
      { kind: "p", lines: [[{ text: "Done." }]] },
    ]);
  });

  it("doesn't read an emphasised opening as a bullet", () => {
    expect(parseAnswer("*Short:* yes")[0]).toEqual({ kind: "p", lines: [[{ text: "Short:", italic: true }, { text: " yes" }]] });
  });

  it("gives nothing for an empty answer", () => {
    expect(parseAnswer("  \n\n")).toEqual([]);
  });
});
