import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { essaySchema } from "@/lib/editor/kit";
import { flatten } from "@/lib/suggest/anchor-text";
import { fromBase64 } from "@/lib/sync/base64";
import { applyEdits, writeWhole } from "./write";

function docOf(...paragraphs: string[]) {
  return prosemirrorJSONToYDoc(
    essaySchema(),
    {
      type: "doc",
      content: paragraphs.map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" })),
    },
    "default",
  );
}

describe("writeWhole", () => {
  it("drafts an empty piece, paragraph by paragraph", () => {
    const doc = new Y.Doc();
    const r = writeWhole(doc, "First paragraph.\n\nSecond paragraph.\nThird.");
    expect(r.before).toBe("");
    expect(flatten(doc).text).toBe("First paragraph.\nSecond paragraph.\nThird.");
    expect(r.update).not.toBeNull();
  });

  it("replaces an existing piece, and the update alone brings another copy up to date", () => {
    const doc = docOf("Old one.", "Old two.");
    const stale = new Y.Doc();
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(doc));
    const r = writeWhole(doc, "Brand new essay.\nWith two paragraphs.");
    expect(r.before).toBe("Old one.\nOld two.");
    Y.applyUpdate(stale, fromBase64(r.update!));
    expect(flatten(stale).text).toBe("Brand new essay.\nWith two paragraphs.");
  });

  it("merges with the student typing at the same moment", () => {
    const doc = docOf("Keep this line.");
    const student = new Y.Doc();
    Y.applyUpdate(student, Y.encodeStateAsUpdate(doc));
    // The student types while the server is writing from the older copy.
    const para = student.getXmlFragment("default").get(0) as Y.XmlElement;
    (para.get(0) as Y.XmlText).insert("Keep this line.".length, " And more.");
    const r = applyEdits(doc, [{ find: "Keep", replace_with: "Hold", reason: "" }]);
    Y.applyUpdate(student, fromBase64(r.update!));
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(student));
    expect(flatten(student).text).toBe("Hold this line. And more.");
    expect(flatten(doc).text).toBe(flatten(student).text);
  });
});

describe("applyEdits", () => {
  it("applies several edits, long and short, including at the very start", () => {
    const doc = docOf(
      "I have always loved building things. When I was ten, I took apart our toaster.",
      "At Northfield, I want to join the robotics club.",
      "That is why I am applying.",
    );
    const r = applyEdits(doc, [
      { find: "I have always loved building things.", replace_with: "Building things has always pulled me in.", reason: "" },
      { find: "took apart our toaster", insert_after: " to see how it worked", reason: "" },
      {
        find: "At Northfield, I want to join the robotics club.",
        replace_with: "At Northfield, I would join the robotics club.\nI would also take the design studio in my first year, because it is where the building happens.",
        reason: "",
      },
      { find: "That is why", replace_with: "That's why", reason: "" },
    ]);
    expect(r.outcomes.every((o) => o.ok)).toBe(true);
    expect(flatten(doc).text).toBe(
      "Building things has always pulled me in. When I was ten, I took apart our toaster to see how it worked.\n" +
        "At Northfield, I would join the robotics club.\n" +
        "I would also take the design studio in my first year, because it is where the building happens.\n" +
        "That's why I am applying.",
    );
  });

  it("replaces a range across paragraphs and can delete", () => {
    const doc = docOf("One.", "Two.", "Three.");
    const r = applyEdits(doc, [
      { find: "One.\nTwo.", replace_with: "One and two.", reason: "" },
      { find: "Three.", replace_with: "", reason: "" },
    ]);
    expect(r.outcomes.every((o) => o.ok)).toBe(true);
    expect(flatten(doc).text).toBe("One and two.\n");
  });

  it("reports edits it can't place, and overlapping ones, without applying them", () => {
    const doc = docOf("Alpha beta gamma.");
    const r = applyEdits(doc, [
      { find: "Alpha beta", replace_with: "A B", reason: "" },
      { find: "beta gamma", replace_with: "B G", reason: "" },
      { find: "delta", replace_with: "D", reason: "" },
    ]);
    expect(r.outcomes.map((o) => o.ok)).toEqual([true, false, false]);
    expect(flatten(doc).text).toBe("A B gamma.");
  });
});
