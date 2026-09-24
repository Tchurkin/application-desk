import type { Node as PMNode } from "@tiptap/pm/model";
import type { Hay } from "./loose";

/*
 * The editor document as plain text, with a map back to ProseMirror positions.
 *
 * The text matches what the connector's flatten() produces from the Yjs document: textblocks
 * separated by one "\n" (empty ones included), hard breaks as "\n". So a quote taken from
 * either side can be found on the other.
 */

export interface DocText {
  text: string;
  /** ProseMirror position where the character at offset i starts. */
  before: number[];
  /** ProseMirror position just after the character at offset i. */
  after: number[];
  /** Position of a range start at `offset` (the start of the character there). */
  posFrom(offset: number): number;
  /** Position of a range end at `offset` (just after the character before it). */
  posTo(offset: number): number;
  /** Offset of a ProseMirror position (the first character at or after it). */
  offsetOf(pos: number): number;
  /** The text for findText, with its loose forms cached alongside. */
  hay: Hay;
}

const cache = new WeakMap<PMNode, DocText>();

export function docText(doc: PMNode): DocText {
  const hit = cache.get(doc);
  if (hit) return hit;
  const chars: string[] = [];
  const before: number[] = [];
  const after: number[] = [];
  let blocks = 0;
  let lastEnd = 1; // end of the previous textblock's content
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const contentStart = pos + 1;
      if (blocks > 0) {
        // The break between two textblocks: deleting it joins them.
        chars.push("\n");
        before.push(lastEnd);
        after.push(contentStart);
      }
      blocks++;
      node.forEach((child, offset) => {
        const at = contentStart + offset;
        if (child.isText) {
          const t = child.text ?? "";
          for (let i = 0; i < t.length; i++) {
            chars.push(t[i]);
            before.push(at + i);
            after.push(at + i + 1);
          }
        } else if (child.type.name === "hardBreak") {
          chars.push("\n");
          before.push(at);
          after.push(at + child.nodeSize);
        }
      });
      lastEnd = contentStart + node.content.size;
      return false;
    }
    return true;
  });
  const text = chars.join("");
  const docEnd = blocks ? lastEnd : 1;
  const dt: DocText = {
    text,
    before,
    after,
    posFrom: (o) => (o < before.length ? before[Math.max(0, o)] : docEnd),
    posTo: (o) => (o > 0 ? after[Math.min(o, after.length) - 1] : before[0] ?? 1),
    offsetOf: (pos) => {
      // First character that starts at or after pos.
      let lo = 0;
      let hi = before.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (before[mid] < pos) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    hay: { text },
  };
  cache.set(doc, dt);
  return dt;
}

/** The text between two ProseMirror positions, in the same terms as docText. */
export function textBetweenPos(dt: DocText, from: number, to: number): string {
  return dt.text.slice(dt.offsetOf(from), dt.offsetOf(to));
}
