/*
 * Copying a piece's document into a new piece (a new version of it).
 *
 * The saved document (snapshot plus edit log) is read as a ProseMirror document and written
 * into a fresh Yjs document, so the copy keeps the formatting (bold, lists, quotes) but none of
 * the original's edit history or deleted text. The result is the new piece's first Yjs update.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { essaySchema } from "@/lib/editor/kit";
import { docFromRows } from "@/lib/suggest/anchor-text";
import { toBase64 } from "@/lib/sync/base64";

const FIELD = "default";

export interface DocCopy {
  /** The new document as one Yjs update (base64), or null when there is nothing to copy. */
  update: string | null;
  /** Its text as the editor shows it (paragraphs separated by "\n"). */
  text: string;
  /** Its ProseMirror JSON, for a first History version. */
  json: ReturnType<PMNode["toJSON"]>;
}

export function copyDoc(source: Y.Doc): DocCopy {
  const schema = essaySchema();
  const { doc } = initProseMirrorDoc(source.getXmlFragment(FIELD), schema);
  const text = doc.textBetween(0, doc.content.size, "\n");
  if (!doc.childCount) return { update: null, text: "", json: doc.toJSON() };
  const fresh = new Y.Doc();
  try {
    const frag = fresh.getXmlFragment(FIELD);
    const { meta } = initProseMirrorDoc(frag, schema);
    fresh.transact(() => updateYFragment(fresh, frag, doc, meta));
    return { update: toBase64(Y.encodeStateAsUpdate(fresh)), text, json: doc.toJSON() };
  } finally {
    fresh.destroy();
  }
}

/** Copy a piece's document from its stored rows (pieces.doc_state and piece_updates). */
export function copyFromRows(state: string, updates: string[]): DocCopy {
  const source = docFromRows(state, updates);
  try {
    return copyDoc(source);
  } finally {
    source.destroy();
  }
}
