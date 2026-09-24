import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { parseOptions } from "@/lib/bridge/options";
import { heldSelectionKey, heldSelectionPlugin } from "./held-selection";
import { locate, rewritesKey, rewritesPlugin, showingRewrite } from "./rewrites";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
});

function start(...paras: string[]) {
  const doc = schema.node(
    "doc",
    null,
    paras.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : [])),
  );
  return EditorState.create({ doc, plugins: [heldSelectionPlugin(), rewritesPlugin("p1")] });
}

describe("rewrite options in an answer", () => {
  it("reads each option and the note around them", () => {
    const r = parseOptions("<option>It never missed a can.</option>\n<option>\nIt sorted faster\nthan I could.\n</option>\nThe first is punchier.");
    expect(r.options).toEqual(["It never missed a can.", "It sorted faster\nthan I could."]);
    expect(r.note).toBe("The first is punchier.");
  });

  it("hides an option still being written, and answers without options stay as they are", () => {
    expect(parseOptions("<option>Done.</option>\n<option>Half wri")).toEqual({ options: ["Done."], note: "" });
    expect(parseOptions("Just an answer.")).toEqual({ options: [], note: "Just an answer." });
  });
});

describe("showing a rewrite in place", () => {
  it("finds the highlighted passage, across paragraphs too", () => {
    const s = start("My robot sorted cans.", "It was very good at it.");
    const at = locate(s, "It was very good at it.")!;
    expect(s.doc.textBetween(at.from, at.to)).toBe("It was very good at it.");
    const both = locate(s, "sorted cans.\nIt was")!;
    expect(s.doc.textBetween(both.from, both.to, "\n")).toBe("sorted cans.\nIt was");
    expect(locate(s, "not in the essay")).toBeNull();
  });

  it("picks the copy nearest the held highlight when the passage appears twice", () => {
    let s = start("Good. Good.");
    s = s.apply(s.tr.setMeta(heldSelectionKey, { from: 7, to: 12 }));
    const at = locate(s, "Good.")!;
    expect(at.from).toBe(7);
  });

  it("follows other people's edits, and goes away if the passage is deleted", () => {
    let s = start("My robot sorted cans.", "It was very good at it.");
    const at = locate(s, "very good")!;
    s = s.apply(s.tr.setMeta(rewritesKey, { show: { requestId: "r", ...at, options: ["great", "fine"], index: 0 } }));
    s = s.apply(s.tr.setMeta(rewritesKey, { index: 1 }));
    expect(showingRewrite(s)?.index).toBe(1);
    s = s.apply(s.tr.insertText("Oh. ", 1));
    const moved = showingRewrite(s)!;
    expect(s.doc.textBetween(moved.from, moved.to)).toBe("very good");
    s = s.apply(s.tr.delete(moved.from, moved.to));
    expect(showingRewrite(s)).toBeNull();
  });
});
