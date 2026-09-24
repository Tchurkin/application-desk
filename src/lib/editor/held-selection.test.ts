import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { heldRange, heldSelectionKey, heldSelectionPlugin } from "./held-selection";

const schema = new Schema({
  nodes: { doc: { content: "paragraph+" }, paragraph: { content: "text*", toDOM: () => ["p", 0] }, text: {} },
});

function start() {
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Hello brave world")])]);
  return EditorState.create({ doc, plugins: [heldSelectionPlugin()] });
}

describe("held selection", () => {
  it("holds a range until it is cleared", () => {
    let s = start();
    expect(heldRange(s)).toBeNull();
    s = s.apply(s.tr.setMeta(heldSelectionKey, { from: 7, to: 12 }));
    expect(heldRange(s)).toEqual({ from: 7, to: 12 });
    expect(s.doc.textBetween(7, 12)).toBe("brave");
    s = s.apply(s.tr.setMeta(heldSelectionKey, null));
    expect(heldRange(s)).toBeNull();
  });

  it("stays on the same words while the text around it changes", () => {
    let s = start();
    s = s.apply(s.tr.setMeta(heldSelectionKey, { from: 7, to: 12 }));
    s = s.apply(s.tr.insertText("Oh, ", 1));
    const held = heldRange(s)!;
    expect(s.doc.textBetween(held.from, held.to)).toBe("brave");
  });

  it("lets go when its words are deleted", () => {
    let s = start();
    s = s.apply(s.tr.setMeta(heldSelectionKey, { from: 7, to: 12 }));
    s = s.apply(s.tr.delete(7, 12));
    expect(heldRange(s)).toBeNull();
  });
});
