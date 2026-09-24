/*
 * Anchoring suggestions from plain text, with no editor in the loop.
 *
 * Claude and ChatGPT see a piece as plain text and propose edits by quoting the words to
 * change. This finds those words in the piece's Yjs document and turns them into the same
 * relative positions the editor uses, so a suggestion made through a connector is drawn,
 * tracked and accepted exactly like one typed by a parent.
 */

import * as Y from "yjs";
import { fromBase64, toBase64 } from "@/lib/sync/base64";

/** One run of text in the document: a Y.XmlText and where its characters sit in `text`. */
interface Segment {
  t: Y.XmlText;
  start: number;
  len: number;
}

export interface FlatDoc {
  /** The document's text, paragraphs separated by "\n". */
  text: string;
  segments: Segment[];
}

export function docFromRows(state: string, updates: string[]): Y.Doc {
  const doc = new Y.Doc();
  Y.transact(doc, () => {
    if (state) Y.applyUpdate(doc, fromBase64(state));
    for (const u of updates) Y.applyUpdate(doc, fromBase64(u));
  });
  return doc;
}

/** The text of a TipTap document stored in Yjs (field "default"), as the editor shows it. */
export function flatten(doc: Y.Doc, field = "default"): FlatDoc {
  const segments: Segment[] = [];
  let text = "";
  let blockOpen = false;

  const visit = (el: Y.XmlElement | Y.XmlFragment) => {
    const kids = el.toArray();
    const inline = kids.some((k) => k instanceof Y.XmlText);
    if (inline) {
      if (blockOpen) text += "\n";
      blockOpen = true;
      for (const k of kids) {
        if (k instanceof Y.XmlText) {
          const s = plain(k);
          segments.push({ t: k, start: text.length, len: s.length });
          text += s;
        } else if (k instanceof Y.XmlElement && k.nodeName === "hardBreak") {
          text += "\n";
        }
      }
      return;
    }
    if (el instanceof Y.XmlElement && kids.length === 0 && el.nodeName === "paragraph") {
      // An empty paragraph still separates the ones around it.
      if (blockOpen) text += "\n";
      blockOpen = true;
      return;
    }
    for (const k of kids) if (k instanceof Y.XmlElement) visit(k);
  };
  visit(doc.getXmlFragment(field));
  return { text, segments };
}

/** Text of an XmlText without the formatting markup toString() adds. */
function plain(t: Y.XmlText): string {
  return t
    .toDelta()
    .map((op: { insert?: unknown }) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
}

/** Paragraph breaks as the essay editor makes them: one or more newlines end a paragraph. */
export function normalizeBreaks(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{2,}/g, "\n");
}

/** Curly quotes, dashes and odd spaces as plain characters, one for one (lengths are kept). */
function normalize(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[   ]/g, " ");
}

export type FindResult = { ok: true; start: number; end: number } | { ok: false; reason: string };

/** Where `quote` occurs in the document. It must occur exactly once. */
export function findQuote(flat: FlatDoc, quote: string): FindResult {
  if (!quote) return { ok: false, reason: "The quoted text is empty." };
  for (const [hay, needle] of [
    [flat.text, quote],
    [normalize(flat.text), normalize(quote)],
  ]) {
    const first = hay.indexOf(needle);
    if (first < 0) continue;
    if (hay.indexOf(needle, first + 1) >= 0) {
      return { ok: false, reason: `"${quote}" appears more than once. Quote a few more words so it is unique.` };
    }
    return { ok: true, start: first, end: first + needle.length };
  }
  return { ok: false, reason: `"${quote}" isn't in the piece. Quote the text exactly as it is now.` };
}

/**
 * A relative position at text offset `off`. assoc 0 sticks to the character after the
 * offset (a range's start); assoc -1 sticks to the character before it (a range's end or an
 * insertion point).
 */
export function anchorAtOffset(flat: FlatDoc, off: number, assoc: -1 | 0): string {
  const { segments } = flat;
  if (!segments.length) throw new Error("The piece is empty.");
  let seg: Segment | undefined;
  if (assoc === 0) {
    seg = segments.find((s) => off >= s.start && off < s.start + s.len);
    // At a paragraph break or the very end: stick to the end of the run before it.
    seg ??= [...segments].reverse().find((s) => s.start + s.len <= off) ?? segments[0];
  } else {
    seg = segments.find((s) => off > s.start && off <= s.start + s.len);
    // Right after a paragraph break: the start of the run that follows it.
    seg ??= segments.find((s) => s.start >= off) ?? segments[segments.length - 1];
  }
  const index = Math.max(0, Math.min(seg.len, off - seg.start));
  return toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(seg.t, index, assoc)));
}

export interface Edit {
  find: string;
  replace_with?: string;
  insert_after?: string;
  reason: string;
}

export interface AnchoredRow {
  kind: "insert" | "delete" | "replace";
  anchor_from: string;
  anchor_to: string | null;
  quote: string;
  body: string;
  note: string;
}

export type EditOutcome = { ok: true; row: AnchoredRow } | { ok: false; reason: string };

/** Turn a proposed edit into an anchored suggestion row, or explain why it can't be. */
export function anchorEdit(flat: FlatDoc, e: Edit): EditOutcome {
  const f = findQuote(flat, e.find);
  if (!f.ok) return f;
  const quote = flat.text.slice(f.start, f.end);
  if (e.insert_after !== undefined && e.replace_with !== undefined) {
    return { ok: false, reason: "Use either replace_with or insert_after, not both." };
  }
  if (e.insert_after !== undefined) {
    if (!e.insert_after) return { ok: false, reason: "insert_after is empty." };
    return {
      ok: true,
      row: {
        kind: "insert",
        anchor_from: anchorAtOffset(flat, f.end, -1),
        anchor_to: null,
        quote: "",
        body: normalizeBreaks(e.insert_after),
        note: e.reason,
      },
    };
  }
  const body = normalizeBreaks(e.replace_with ?? "");
  if (body === quote) return { ok: false, reason: "The replacement is the same as the original." };
  return {
    ok: true,
    row: {
      kind: body ? "replace" : "delete",
      anchor_from: anchorAtOffset(flat, f.start, 0),
      anchor_to: anchorAtOffset(flat, f.end, -1),
      quote,
      body,
      note: e.reason,
    },
  };
}
