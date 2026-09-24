// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { essayStarterKit } from "./kit";
import { UndoCaret } from "./undo-caret";

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

function setup(text: string) {
  const ydoc = new Y.Doc();
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [essayStarterKit(), Collaboration.configure({ document: ydoc, field: "default" }), UndoCaret],
  });
  editor.commands.focus("end");
  editor.commands.insertContent(text);
  // Start a new undo step, as a pause in typing would.
  (yUndoPluginKey.getState(editor.state) as { undoManager: Y.UndoManager }).undoManager.stopCapturing();
  return editor;
}

const caret = (ed: Editor) => ed.state.selection.from;

describe("caret after undo and redo", () => {
  it("undoing a Backspace puts the caret after the restored letter", () => {
    const ed = setup("Hello");
    ed.commands.setTextSelection(6); // after "o"
    ed.commands.deleteRange({ from: 5, to: 6 }); // Backspace
    expect(ed.getText()).toBe("Hell");
    expect(caret(ed)).toBe(5);
    ed.commands.undo();
    expect(ed.getText()).toBe("Hello");
    expect(caret(ed)).toBe(6);
  });

  it("undoing the deletion of a whole word puts the caret after the word", () => {
    const ed = setup("One two three");
    ed.commands.deleteRange({ from: 4, to: 8 }); // " two"
    expect(ed.getText()).toBe("One three");
    ed.commands.undo();
    expect(ed.getText()).toBe("One two three");
    expect(caret(ed)).toBe(8);
  });

  it("undoing typing leaves the caret where the text was", () => {
    const ed = setup("Start");
    ed.commands.insertContent(" more");
    ed.commands.undo();
    expect(ed.getText()).toBe("Start");
    expect(caret(ed)).toBe(6);
  });

  it("redo puts the caret after what came back", () => {
    const ed = setup("Start");
    ed.commands.insertContent(" more");
    ed.commands.undo();
    ed.commands.redo();
    expect(ed.getText()).toBe("Start more");
    expect(caret(ed)).toBe(11);
  });
});
