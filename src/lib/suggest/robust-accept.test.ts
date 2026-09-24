// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { essayStarterKit } from "@/lib/editor/kit";
import { anchorEdit, flatten, type Edit } from "./anchor-text";
import { acceptInto, resolveSuggestion } from "./plugin";
import type { Suggestion } from "./store";

/*
 * Suggestions keep working when paragraphs move. Joining, splitting or restructuring
 * paragraphs makes y-prosemirror re-create the moved text as new characters, which used to
 * leave other suggestions' anchors on deleted text: "its text is gone" with Accept disabled,
 * or an edit applied in the wrong place.
 */

let editor: Editor | null = null;
afterEach(() => editor?.destroy());

const P1 = "I have always loved building things. When I was ten, I took apart our toaster to see how it worked.";
const P2 = "At Northfield, I want to join the robotics club. I also want to study mechanical engineering, because the design courses are hands-on.";
const P3 = "That is why I am applying. I hope to spend four years building things with people who love it as much as I do.";

function setup(paragraphs: string[]) {
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
  return { ydoc, ed: editor };
}

let n = 0;
function suggestions(ydoc: Y.Doc, edits: Omit<Edit, "reason">[]): Suggestion[] {
  const flat = flatten(ydoc);
  return edits.map((e) => {
    const r = anchorEdit(flat, { ...e, reason: "" });
    if (!r.ok) throw new Error(r.reason);
    n++;
    return { id: `s${n}`, piece_id: "p", author_id: "a", author_name: "Claude", source: "ai", status: "open", version: 1, created_at: "", ...r.row };
  });
}

const text = (ed: Editor) => ed.getText({ blockSeparator: "\n" });

describe("suggestions survive paragraphs moving", () => {
  it("accepting an edit that joins two paragraphs leaves the next suggestion in them acceptable", () => {
    const { ydoc, ed } = setup([P1, P2, P3]);
    const [join, later] = suggestions(ydoc, [
      { find: "how it worked.\nAt Northfield,", replace_with: "how it worked, and at Northfield" },
      { find: "I also want to study mechanical engineering", replace_with: "I plan to study mechanical engineering" },
    ]);
    expect(acceptInto(ed.view, join)).toBe(true);
    const r = resolveSuggestion(ed.state, later);
    expect(r.gone).toBe(false);
    expect(acceptInto(ed.view, later)).toBe(true);
    expect(text(ed)).toBe(
      P1.replace("how it worked.", "how it worked, and at Northfield") +
        P2.replace("At Northfield,", "").replace("I also want to study", "I plan to study") +
        "\n" +
        P3,
    );
  });

  it("the student splitting a paragraph (Enter) doesn't strand a long suggestion in the moved text", () => {
    const { ydoc, ed } = setup([P1, P2, P3]);
    const [s] = suggestions(ydoc, [
      { find: "I also want to study mechanical engineering, because the design courses are hands-on.", replace_with: "I also want to study mechanical engineering, because Northfield's design studio puts first-years on real projects from day one, and that is how I learn best." },
    ]);
    // Enter right after "robotics club."
    const at = text(ed).indexOf("robotics club.") + "robotics club.".length;
    ed.commands.setTextSelection(posOfOffset(ed, at));
    ed.commands.splitBlock();
    expect(resolveSuggestion(ed.state, s).gone).toBe(false);
    expect(acceptInto(ed.view, s)).toBe(true);
    expect(text(ed)).toContain("robotics club.\n I also want to study mechanical engineering, because Northfield's design studio");
  });

  it("a suggestion swallowed by an accepted rewrite is gone, not applied somewhere else", () => {
    const { ydoc, ed } = setup([P1, P2, P3]);
    const [rewrite, inner] = suggestions(ydoc, [
      { find: P2, replace_with: "At Northfield I would join the robotics club and study mechanical engineering." },
      { find: "the design courses are hands-on", replace_with: "the design courses are hands-on and project-based" },
    ]);
    expect(acceptInto(ed.view, rewrite)).toBe(true);
    const r = resolveSuggestion(ed.state, inner);
    expect(r.gone).toBe(true);
    expect(text(ed)).toBe([P1, "At Northfield I would join the robotics club and study mechanical engineering.", P3].join("\n"));
  });

  it("an insertion after a paragraph merge lands after its words, not at the next paragraph", () => {
    const { ydoc, ed } = setup([P1, P2, P3]);
    const [join, ins] = suggestions(ydoc, [
      { find: "how it worked.\nAt Northfield,", replace_with: "how it worked. At Northfield," },
      { find: "join the robotics club.", insert_after: " I have already emailed the captain." },
    ]);
    expect(acceptInto(ed.view, join)).toBe(true);
    expect(acceptInto(ed.view, ins)).toBe(true);
    expect(text(ed)).toContain("join the robotics club. I have already emailed the captain. I also want");
  });

  it("a batch gives the same essay whichever order it is accepted in", () => {
    const edits = [
      { find: "I have always loved building things.", replace_with: "Building things has always pulled me in." },
      { find: "how it worked.\nAt Northfield,", replace_with: "how it worked. At Northfield," },
      { find: "because the design courses are hands-on.", replace_with: "because the design courses are hands-on.\nThat matters to me." },
      { find: "That is why I am applying.", replace_with: "That's why I'm applying." },
      { find: "as much as I do.", insert_after: " Northfield is that place." },
    ];
    const results = [
      [0, 1, 2, 3, 4],
      [4, 3, 2, 1, 0],
      [2, 0, 4, 1, 3],
    ].map((order) => {
      const { ydoc, ed } = setup([P1, P2, P3]);
      const all = suggestions(ydoc, edits);
      for (const i of order) expect(acceptInto(ed.view, all[i])).toBe(true);
      const t = text(ed);
      ed.destroy();
      editor = null;
      return t;
    });
    expect(results[1]).toBe(results[0]);
    expect(results[2]).toBe(results[0]);
    expect(results[0]).toBe(
      "Building things has always pulled me in. When I was ten, I took apart our toaster to see how it worked. At Northfield, I want to join the robotics club. I also want to study mechanical engineering, because the design courses are hands-on.\n" +
        "That matters to me.\n" +
        "That's why I'm applying. I hope to spend four years building things with people who love it as much as I do. Northfield is that place.",
    );
  });

  it("wrapping a paragraph in a list keeps its suggestion acceptable", () => {
    const { ydoc, ed } = setup([P1, P2, P3]);
    const [s] = suggestions(ydoc, [{ find: "join the robotics club", replace_with: "lead the robotics club" }]);
    ed.commands.setTextSelection(posOfOffset(ed, text(ed).indexOf("At Northfield") + 3));
    ed.commands.toggleBulletList();
    expect(resolveSuggestion(ed.state, s).gone).toBe(false);
    expect(acceptInto(ed.view, s)).toBe(true);
    expect(text(ed)).toContain("lead the robotics club");
  });
});

/** The editor position of a character offset in getText({blockSeparator: "\n"}). */
function posOfOffset(ed: Editor, offset: number): number {
  let seen = 0;
  let found = -1;
  let first = true;
  ed.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isTextblock) {
      if (!first) seen += 1;
      first = false;
      const len = node.textContent.length;
      if (offset <= seen + len) {
        found = pos + 1 + (offset - seen);
        return false;
      }
      seen += len;
      return false;
    }
    return true;
  });
  return found;
}
