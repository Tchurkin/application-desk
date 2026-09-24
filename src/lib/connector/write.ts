/*
 * Writing a piece directly, on the server, for the Claude/ChatGPT connector.
 *
 * The piece's Yjs document is loaded as a ProseMirror document, changed with ordinary
 * ProseMirror steps, and diffed back into Yjs. The result is one Yjs update appended to the
 * piece's edit log, so it merges with whatever the student is typing at the same moment and
 * reaches their open editor live, exactly like an edit from another tab.
 */

import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorState, Selection, type Transaction } from "@tiptap/pm/state";
import { initProseMirrorDoc, relativePositionToAbsolutePosition, updateYFragment } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { insertLines } from "@/lib/editor/insert-lines";
import { essaySchema } from "@/lib/editor/kit";
import { fromBase64, toBase64 } from "@/lib/sync/base64";
import { anchorEdit, flatten, normalizeBreaks, type Edit } from "@/lib/suggest/anchor-text";

const FIELD = "default";

interface Loaded {
  state: EditorState;
  frag: Y.XmlFragment;
  meta: ReturnType<typeof initProseMirrorDoc>["meta"];
}

function load(ydoc: Y.Doc): Loaded {
  const schema = essaySchema();
  const frag = ydoc.getXmlFragment(FIELD);
  const { doc, meta } = initProseMirrorDoc(frag, schema);
  // An empty piece has no paragraph yet; the editor shows one, so start from one.
  const start = doc.childCount ? doc : schema.topNodeType.createAndFill()!;
  return { state: EditorState.create({ doc: start, schema }), frag, meta };
}

/** Commit a ProseMirror change to the Yjs document; returns the Yjs update (base64) or null. */
function commit(ydoc: Y.Doc, l: Loaded, tr: Transaction): string | null {
  if (!tr.docChanged) return null;
  const before = Y.encodeStateVector(ydoc);
  ydoc.transact(() => updateYFragment(ydoc, l.frag, tr.doc, l.meta));
  return toBase64(Y.encodeStateAsUpdate(ydoc, before));
}

export interface WriteResult {
  update: string | null;
  /** The text before and after, as the editor shows it. */
  before: string;
  after: string;
  /** The document before, for the history snapshot. */
  beforeJSON: ReturnType<PMNode["toJSON"]>;
}

function text(doc: PMNode) {
  return doc.textBetween(0, doc.content.size, "\n");
}

/** Replace the whole piece with `body` (paragraphs separated by newlines). */
export function writeWhole(ydoc: Y.Doc, body: string): WriteResult {
  const l = load(ydoc);
  const schema = l.state.schema;
  const paragraphs = normalizeBreaks(body.trim())
    .split("\n")
    .map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : null));
  const content = paragraphs.length ? paragraphs : [schema.nodes.paragraph.create()];
  const tr = l.state.tr.replaceWith(0, l.state.doc.content.size, content);
  return { update: commit(ydoc, l, tr), before: text(l.state.doc), after: text(tr.doc), beforeJSON: l.state.doc.toJSON() };
}

/** A relative position, resolved against the document as loaded here. */
function resolveHere(ydoc: Y.Doc, l: Loaded, anchor: string): number | null {
  const rel = Y.decodeRelativePosition(fromBase64(anchor));
  let pos = relativePositionToAbsolutePosition(ydoc, l.frag, rel, l.meta.mapping as never);
  if (pos === null) {
    // y-prosemirror refuses text positions at the very start of the document; find it by hand.
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, ydoc);
    if (abs && abs.type instanceof Y.XmlText && abs.type.parent instanceof Y.XmlElement) {
      const node = l.meta.mapping.get(abs.type.parent) as PMNode | undefined;
      let nodePos = -1;
      l.state.doc.descendants((n, p) => {
        if (nodePos >= 0) return false;
        if (n === node) nodePos = p;
        return nodePos < 0;
      });
      if (nodePos >= 0) {
        let offset = 0;
        for (const k of abs.type.parent.toArray()) {
          if (k === abs.type) break;
          offset += k instanceof Y.XmlText ? k.length : ((l.meta.mapping.get(k) as PMNode | undefined)?.nodeSize ?? 0);
        }
        pos = nodePos + 1 + offset + abs.index;
      }
    }
  }
  if (pos === null) return null;
  const $p = l.state.doc.resolve(Math.max(0, Math.min(pos, l.state.doc.content.size)));
  return $p.parent.inlineContent ? $p.pos : Selection.near($p, 1).from;
}

export interface EditOutcome {
  index: number;
  ok: boolean;
  reason?: string;
}

/** Apply edits directly. Every edit is located first, then applied back to front. */
export function applyEdits(ydoc: Y.Doc, edits: Edit[]): WriteResult & { outcomes: EditOutcome[] } {
  const l = load(ydoc);
  const flat = flatten(ydoc, FIELD);
  const located: { index: number; from: number; to: number; body: string }[] = [];
  const outcomes: EditOutcome[] = [];
  edits.forEach((e, index) => {
    const r = anchorEdit(flat, e);
    if (!r.ok) return outcomes.push({ index, ok: false, reason: r.reason });
    const row = r.row;
    const from = resolveHere(ydoc, l, row.anchor_from);
    const to = row.anchor_to ? resolveHere(ydoc, l, row.anchor_to) : from;
    if (from === null || to === null || to < from) return outcomes.push({ index, ok: false, reason: "Couldn't place this edit." });
    const overlaps = located.find((o) => from < o.to && o.from < to);
    if (overlaps) return outcomes.push({ index, ok: false, reason: `Overlaps edit ${overlaps.index + 1}; send it on its own.` });
    located.push({ index, from, to, body: row.body });
    outcomes.push({ index, ok: true });
  });
  const tr = l.state.tr;
  for (const e of [...located].sort((a, b) => b.from - a.from || b.to - a.to)) {
    if (e.to > e.from) tr.delete(e.from, e.to);
    if (e.body) insertLines(tr, Math.min(e.from, tr.doc.content.size), e.body);
  }
  return {
    update: commit(ydoc, l, tr),
    before: text(l.state.doc),
    after: text(tr.doc),
    beforeJSON: l.state.doc.toJSON(),
    outcomes: outcomes.sort((a, b) => a.index - b.index),
  };
}
