import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fromBase64 } from "@/lib/sync/base64";
import { anchorEdit, findQuote, flatten, type FlatDoc } from "./anchor-text";

const schema = getSchema([StarterKit]);

/** A Yjs document exactly as the editor stores it. */
function docOf(...paragraphs: string[]) {
  const json = {
    type: "doc",
    content: paragraphs.map((p) => (p ? { type: "paragraph", content: [{ type: "text", text: p }] } : { type: "paragraph" })),
  };
  return prosemirrorJSONToYDoc(schema, json, "default");
}

/** Where an anchor points now, as an offset into the flattened text. */
function offsetOf(doc: Y.Doc, flat: FlatDoc, anchor: string): number {
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromBase64(anchor)), doc)!;
  const seg = flat.segments.find((s) => s.t === abs.type)!;
  return seg.start + abs.index;
}

describe("flatten", () => {
  it("reads paragraphs as lines, like the editor's text", () => {
    const doc = docOf("First line.", "", "Third line.");
    expect(flatten(doc).text).toBe("First line.\n\nThird line.");
  });

  it("ignores formatting", () => {
    const json = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Plain " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " end." },
          ],
        },
      ],
    };
    expect(flatten(prosemirrorJSONToYDoc(schema, json, "default")).text).toBe("Plain bold end.");
  });
});

describe("anchorEdit", () => {
  it("anchors a replacement on exactly the quoted words", () => {
    const doc = docOf("The cat sat on the mat.");
    const flat = flatten(doc);
    const r = anchorEdit(flat, { find: "cat sat", replace_with: "dog lay", reason: "stronger verb" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row).toMatchObject({ kind: "replace", quote: "cat sat", body: "dog lay", note: "stronger verb" });
    expect(offsetOf(doc, flat, r.row.anchor_from)).toBe(4);
    expect(offsetOf(doc, flat, r.row.anchor_to!)).toBe(11);
  });

  it("keeps the anchor on the same words after the text around it changes", () => {
    const doc = docOf("The cat sat on the mat.");
    const r = anchorEdit(flatten(doc), { find: "the mat", replace_with: "the rug", reason: "" });
    if (!r.ok) throw new Error(r.reason);
    const text = doc.getXmlFragment("default").get(0) as Y.XmlElement;
    (text.get(0) as Y.XmlText).insert(0, "Yesterday, ");
    const flat = flatten(doc);
    const from = offsetOf(doc, flat, r.row.anchor_from);
    const to = offsetOf(doc, flat, r.row.anchor_to!);
    expect(flat.text.slice(from, to)).toBe("the mat");
  });

  it("insert_after anchors at the end of the quote", () => {
    const doc = docOf("One. Two.");
    const flat = flatten(doc);
    const r = anchorEdit(flat, { find: "One.", insert_after: " And a half.", reason: "" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.row.kind).toBe("insert");
    expect(offsetOf(doc, flat, r.row.anchor_from)).toBe(4);
  });

  it("an empty replacement is a deletion, across a paragraph break too", () => {
    const doc = docOf("Keep this.", "Drop this.");
    const flat = flatten(doc);
    const r = anchorEdit(flat, { find: "\nDrop this.", replace_with: "", reason: "" });
    if (!r.ok) throw new Error(r.reason);
    expect(r.row.kind).toBe("delete");
    expect(offsetOf(doc, flat, r.row.anchor_from)).toBe(10);
    expect(offsetOf(doc, flat, r.row.anchor_to!)).toBe(21);
  });

  it("refuses quotes that are missing or ambiguous, and no-op edits", () => {
    const flat = flatten(docOf("the the end"));
    expect(anchorEdit(flat, { find: "the", replace_with: "a", reason: "" })).toMatchObject({ ok: false });
    expect(anchorEdit(flat, { find: "nowhere", replace_with: "x", reason: "" })).toMatchObject({ ok: false });
    expect(anchorEdit(flat, { find: "end", replace_with: "end", reason: "" })).toMatchObject({ ok: false });
  });

  it("matches curly quotes and dashes against straight ones", () => {
    const flat = flatten(docOf("It’s a long—very long—day."));
    const f = findQuote(flat, "It's a long-very long-day");
    expect(f.ok).toBe(true);
  });
});
