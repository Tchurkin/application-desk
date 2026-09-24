// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { essayStarterKit } from "@/lib/editor/kit";
import { anchorEdit, flatten } from "./anchor-text";
import { acceptInto } from "./plugin";
import type { Suggestion } from "./store";

/*
 * Accepting suggestions whose text has paragraph breaks: the exact result, not just "it
 * changed". A mapping bug once put later paragraphs in the wrong place, or threw near the end
 * of the essay so Accept did nothing.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
];

function typed(paragraphs: string[]) {
  const ydoc = new Y.Doc();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [essayStarterKit(), Collaboration.configure({ document: ydoc, field: "default" })],
  });
  editor.commands.focus("end");
  paragraphs.forEach((p, i) => {
    if (i > 0) editor!.commands.splitBlock();
    editor!.commands.insertContent(p);
  });
  return { ydoc, editor };
}

function accept(paragraphs: string[], edit: { find: string; replace_with?: string; insert_after?: string }) {
  const { ydoc, editor: ed } = typed(paragraphs);
  const r = anchorEdit(flatten(ydoc), { ...edit, reason: "" });
  if (!r.ok) throw new Error(r.reason);
  const s: Suggestion = { id: "x", piece_id: "p", author_id: "a", author_name: "Claude", source: "ai", status: "open", version: 1, created_at: "", ...r.row };
  expect(acceptInto(ed.view, s)).toBe(true);
  return ed.getText({ blockSeparator: "\n" });
}

const ESSAY = ["First paragraph of mine.", "Second paragraph of mine.", "Third paragraph of mine."];

describe("accepting multi-paragraph suggestions", () => {
  it("three paragraphs of lorem ipsum added after the last paragraph", () => {
    expect(accept(ESSAY, { find: "Third paragraph of mine.", insert_after: "\n\n" + LOREM.join("\n\n") })).toBe(
      [...ESSAY, ...LOREM].join("\n"),
    );
  });

  it("three paragraphs replacing the middle paragraph", () => {
    expect(accept(ESSAY, { find: "Second paragraph of mine.", replace_with: LOREM.join("\n\n") })).toBe(
      [ESSAY[0], ...LOREM, ESSAY[2]].join("\n"),
    );
  });

  it("three paragraphs replacing the last paragraph (the end of the document)", () => {
    expect(accept(ESSAY, { find: "Third paragraph of mine.", replace_with: LOREM.join("\n") })).toBe(
      [ESSAY[0], ESSAY[1], ...LOREM].join("\n"),
    );
  });

  it("three paragraphs replacing the whole essay", () => {
    expect(accept(ESSAY, { find: ESSAY.join("\n"), replace_with: LOREM.join("\n\n") })).toBe(LOREM.join("\n"));
  });

  it("a replacement in the middle of a sentence that splits it into paragraphs", () => {
    expect(accept(["Alpha beta gamma delta."], { find: "beta gamma", replace_with: "beta\nnew\ngamma" })).toBe(
      "Alpha beta\nnew\ngamma delta.",
    );
  });

  it("Windows line endings", () => {
    expect(accept(ESSAY, { find: "Second paragraph of mine.", replace_with: "One.\r\nTwo." })).toBe(
      [ESSAY[0], "One.", "Two.", ESSAY[2]].join("\n"),
    );
  });
});
