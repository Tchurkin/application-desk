import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { essaySchema } from "@/lib/editor/kit";
import { docFromRows, flatten } from "@/lib/suggest/anchor-text";
import { fromBase64, toBase64 } from "@/lib/sync/base64";
import { copyDoc, copyFromRows } from "./copy-doc";

function source() {
  return prosemirrorJSONToYDoc(
    essaySchema(),
    {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "I built a " },
            { type: "text", text: "robot", marks: [{ type: "bold" }] },
            { type: "text", text: "." },
          ],
        },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "It walked." }] }] }] },
      ],
    },
    "default",
  );
}

describe("copyDoc", () => {
  it("copies the text and formatting into a fresh document", () => {
    const src = source();
    const c = copyDoc(src);
    expect(c.text).toBe("I built a robot.\nIt walked.");
    const copy = new Y.Doc();
    Y.applyUpdate(copy, fromBase64(c.update!));
    expect(flatten(copy).text).toBe(flatten(src).text);
    const para = copy.getXmlFragment("default").get(0) as Y.XmlElement;
    const delta = (para.get(0) as Y.XmlText).toDelta() as { insert: string; attributes?: Record<string, unknown> }[];
    expect(delta.find((op) => op.insert === "robot")?.attributes).toHaveProperty("bold");
    expect(JSON.stringify(c.json)).toContain("bulletList");
  });

  it("leaves the original's deleted text and history behind", () => {
    const src = source();
    const para = src.getXmlFragment("default").get(0) as Y.XmlElement;
    (para.get(0) as Y.XmlText).insert(0, "x".repeat(5000));
    (para.get(0) as Y.XmlText).delete(0, 5000);
    const c = copyDoc(src);
    expect(fromBase64(c.update!).length).toBeLessThan(Y.encodeStateAsUpdate(src).length);
  });

  it("copies nothing from an empty piece", () => {
    const c = copyDoc(new Y.Doc());
    expect(c.update).toBeNull();
    expect(c.text).toBe("");
  });

  it("reads a piece from its stored snapshot and edit log", () => {
    const src = source();
    const state = toBase64(Y.encodeStateAsUpdate(src));
    const later = new Y.Doc();
    Y.applyUpdate(later, Y.encodeStateAsUpdate(src));
    const before = Y.encodeStateVector(later);
    const p = later.getXmlFragment("default").get(0) as Y.XmlElement;
    (p.get(0) as Y.XmlText).insert(0, "Yes, ");
    const update = toBase64(Y.encodeStateAsUpdate(later, before));
    const c = copyFromRows(state, [update]);
    expect(c.text.startsWith("Yes, I built a robot.")).toBe(true);
    expect(flatten(docFromRows("", [c.update!])).text).toBe(c.text);
  });
});
