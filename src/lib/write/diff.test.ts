import { describe, expect, it } from "vitest";
import { tokenize, wordDiff, type DiffSegment } from "./diff";

const marked = (segs: DiffSegment[], kind: DiffSegment["kind"]) => segs.filter((s) => s.kind === kind).map((s) => s.text);
const joined = (segs: DiffSegment[]) => segs.map((s) => s.text).join("");

describe("tokenize", () => {
  it("keeps every character, whitespace included", () => {
    const text = "  One two\n\nthree  ";
    const tokens = tokenize(text);
    expect(tokens.map((t) => t.word + t.space).join("")).toBe(text);
    expect(tokens.map((t) => t.word)).toEqual(["", "One", "two", "three"]);
  });

  it("gives nothing for empty text", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("wordDiff", () => {
  it("finds no differences between identical texts", () => {
    const d = wordDiff("The cat sat.", "The cat sat.");
    expect(d.removed).toBe(0);
    expect(d.added).toBe(0);
    expect(d.left).toEqual([{ text: "The cat sat.", kind: "same" }]);
    expect(d.right).toEqual([{ text: "The cat sat.", kind: "same" }]);
  });

  it("marks a replaced word on both sides, and both sides read as their originals", () => {
    const a = "The cat sat on the mat.";
    const b = "The dog sat on the mat.";
    const d = wordDiff(a, b);
    expect(marked(d.left, "removed")).toEqual(["cat"]);
    expect(marked(d.right, "added")).toEqual(["dog"]);
    expect(joined(d.left)).toBe(a);
    expect(joined(d.right)).toBe(b);
    expect(d.removed).toBe(1);
    expect(d.added).toBe(1);
  });

  it("marks inserted and deleted phrases as one highlight each", () => {
    const d = wordDiff("I built a robot last year with friends.", "I built a small red robot last spring.");
    expect(marked(d.right, "added")).toEqual(["small red", "spring."]);
    expect(marked(d.left, "removed")).toEqual(["year with friends."]);
  });

  it("ignores changes in spacing and line breaks", () => {
    const d = wordDiff("One two.\nThree.", "One  two.\n\nThree.");
    expect(d.removed).toBe(0);
    expect(d.added).toBe(0);
  });

  it("handles empty texts on either side", () => {
    const fresh = wordDiff("", "All new words");
    expect(fresh.added).toBe(3);
    expect(marked(fresh.right, "added")).toEqual(["All new words"]);
    const gone = wordDiff("Nothing left", "");
    expect(gone.removed).toBe(2);
    expect(gone.right).toEqual([]);
  });

  it("finds the longest common run when words move", () => {
    const d = wordDiff("a b c d e", "b c d e a");
    expect(d.removed).toBe(1);
    expect(d.added).toBe(1);
    expect(marked(d.left, "removed")).toEqual(["a"]);
  });

  it("stays fast on long essays that differ in a few places", () => {
    const words = Array.from({ length: 3000 }, (_, i) => `w${i}`);
    const a = words.join(" ");
    const b = [...words.slice(0, 1500), "inserted", ...words.slice(1500)].join(" ");
    const t = Date.now();
    const d = wordDiff(a, b);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(d.added).toBe(1);
    expect(d.removed).toBe(0);
  });
});
