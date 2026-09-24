// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import StarterKit from "@tiptap/starter-kit";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { anchorEdit, flatten } from "./anchor-text";
import { anchorAt, resolveAnchor } from "./plugin";

/*
 * Anchors made on the server from plain text, and by suggesters in the editor, must resolve
 * to the right places in a real editor bound to the Yjs document.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function typed(...paragraphs: string[]) {
  const ydoc = new Y.Doc();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ undoRedo: false }), Collaboration.configure({ document: ydoc, field: "default" })],
  });
  editor.commands.focus("end");
  paragraphs.forEach((p, i) => {
    if (i > 0) editor!.commands.splitBlock();
    for (const ch of p) editor!.commands.insertContent(ch);
  });
  return { ydoc, editor };
}

function range(ed: Editor, from: string, to: string | null) {
  const a = resolveAnchor(ed.state, from);
  const b = to ? resolveAnchor(ed.state, to) : null;
  return { a, b, text: a !== null && b !== null ? ed.state.doc.textBetween(a, b, "\n") : null };
}

describe("anchors in a real editor", () => {
  it("an edit starting at the very first word resolves (the library alone discards it)", () => {
    const { ydoc, editor: ed } = typed("I have always loved building things. When I was ten.", "Second para.");
    const r = anchorEdit(flatten(ydoc), { find: "I have always loved building things.", replace_with: "X.", reason: "" });
    if (!r.ok) throw new Error(r.reason);
    expect(range(ed, r.row.anchor_from, r.row.anchor_to).text).toBe("I have always loved building things.");
  });

  it("edits in later paragraphs and across a paragraph break resolve", () => {
    const { ydoc, editor: ed } = typed("One two.", "Three four.", "Five.");
    const flat = flatten(ydoc);
    for (const find of ["Three", "four.\nFive", "Five."]) {
      const r = anchorEdit(flat, { find, replace_with: "z", reason: "" });
      if (!r.ok) throw new Error(r.reason);
      expect(range(ed, r.row.anchor_from, r.row.anchor_to).text).toBe(find);
    }
  });

  it("an insertion after the last word resolves to the end of the text", () => {
    const { ydoc, editor: ed } = typed("Only line.");
    const r = anchorEdit(flatten(ydoc), { find: "line.", insert_after: " More.", reason: "" });
    if (!r.ok) throw new Error(r.reason);
    expect(resolveAnchor(ed.state, r.row.anchor_from)).toBe(1 + "Only line.".length);
  });

  it("a suggester's anchor on the first character resolves too", () => {
    const { editor: ed } = typed("Hello there.");
    const from = anchorAt(ed.state, 1, 0);
    const to = anchorAt(ed.state, 6, -1);
    expect(range(ed, from, to).text).toBe("Hello");
  });
});
