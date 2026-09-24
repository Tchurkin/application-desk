import { Selection, type Transaction } from "@tiptap/pm/state";
import { normalizeBreaks } from "@/lib/suggest/anchor-text";

/**
 * Insert text that may contain paragraph breaks at `at` (a position in tr.doc as it is now),
 * splitting paragraphs at each break. Returns the position after the inserted text.
 *
 * Used both when a student accepts a suggestion and when the connector writes directly.
 */
export function insertLines(tr: Transaction, at: number, text: string): number {
  let pos = at;
  normalizeBreaks(text)
    .split("\n")
    .forEach((line, i) => {
      if (i > 0) {
        tr.split(pos);
        // Map only through the split just made: pos is already a position in the current
        // document, so mapping it through the whole transaction would move it too far.
        const split = tr.mapping.maps[tr.mapping.maps.length - 1];
        pos = Selection.near(tr.doc.resolve(split.map(pos, 1)), 1).from;
      }
      if (line) {
        tr.insertText(line, pos);
        pos += line.length;
      }
    });
  return pos;
}
