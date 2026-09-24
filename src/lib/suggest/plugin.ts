/*
 * Suggestions in the editor.
 *
 * Nobody but the student ever changes the student's text. In suggest mode, typing, deleting,
 * pasting and Enter become suggestions (rows in the store), and any other change to the
 * document is refused. Suggestions are drawn over the text with decorations: deletions struck
 * through, insertions as a marked widget.
 *
 * Every suggestion is anchored with Yjs relative positions, so it stays on the same letters
 * however the document changes around it, and so does everyone's caret.
 */

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { Plugin, PluginKey, Selection, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { fromBase64, toBase64 } from "@/lib/sync/base64";
import type { Suggestion, SuggestionStore } from "./store";

export type SuggestMode = "owner" | "suggest" | "view";

export interface SuggestOptions {
  store: SuggestionStore;
  mode: SuggestMode;
  me: { id: string; name: string };
  pieceId: string;
  /** Called when a suggestion is clicked. */
  onPick?: (id: string) => void;
}

export const suggestKey = new PluginKey<{ tick: number; picked: string | null }>("suggest");

// ─── anchors ────────────────────────────────────────────────────────────────

interface YCtx {
  doc: Y.Doc;
  type: Y.XmlFragment;
  mapping: Map<unknown, unknown>;
}

function yctx(state: EditorState): YCtx | null {
  const ys = ySyncPluginKey.getState(state) as
    | { doc: Y.Doc; type: Y.XmlFragment; binding: { mapping: Map<unknown, unknown> } | null }
    | undefined;
  if (!ys || !ys.binding) return null;
  return { doc: ys.doc, type: ys.type, mapping: ys.binding.mapping };
}

/**
 * A relative position for `pos`. assoc -1 sticks to the character before it (an insertion
 * point, or the end of a range); assoc 0 sticks to the character after it (a range's start).
 */
export function anchorAt(state: EditorState, pos: number, assoc: -1 | 0): string {
  const y = yctx(state);
  if (!y) throw new Error("editor is not bound to the document yet");
  let rel = absolutePositionToRelativePosition(pos, y.type, y.mapping as never);
  if (assoc === 0) {
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, y.doc);
    if (abs) rel = Y.createRelativePositionFromTypeIndex(abs.type, abs.index, 0);
  }
  return toBase64(Y.encodeRelativePosition(rel));
}

/** Where an anchor is now, as a position inside text, or null if its text is gone. */
export function resolveAnchor(state: EditorState, anchor: string): number | null {
  const y = yctx(state);
  if (!y) return null;
  let pos: number | null;
  try {
    const rel = Y.decodeRelativePosition(fromBase64(anchor));
    // y-prosemirror discards any text position that lands at the very start of the document
    // as "misresolved" (a guard meant for carets), which would lose an anchor on the first
    // word. When it gives up, resolve through the document structure instead.
    pos = relativePositionToAbsolutePosition(y.doc, y.type, rel, y.mapping as never) ?? resolveInText(state, y, rel);
  } catch {
    return null;
  }
  if (pos === null) return null;
  return clampToText(state.doc, pos);
}

/** A position inside a paragraph's text, found through the paragraph's node. */
function resolveInText(state: EditorState, y: YCtx, rel: Y.RelativePosition): number | null {
  const abs = Y.createAbsolutePositionFromRelativePosition(rel, y.doc);
  if (!abs || !(abs.type instanceof Y.XmlText)) return null;
  const parent = abs.type.parent;
  if (!(parent instanceof Y.XmlElement)) return null;
  const node = y.mapping.get(parent);
  if (!node) return null;
  let nodePos = -1;
  state.doc.descendants((n, p) => {
    if (nodePos >= 0) return false;
    if (n === node) {
      nodePos = p;
      return false;
    }
    return true;
  });
  if (nodePos < 0) return null;
  let offset = 0;
  for (const k of parent.toArray()) {
    if (k === abs.type) break;
    if (k instanceof Y.XmlText) offset += k.length;
    else {
      const mapped = y.mapping.get(k) as PMNode | undefined;
      if (!mapped) return null;
      offset += mapped.nodeSize;
    }
  }
  return nodePos + 1 + offset + abs.index;
}

/** An empty document has no text node yet: put positions inside the first paragraph. */
function clampToText(doc: PMNode, pos: number): number {
  const max = doc.content.size;
  const p = Math.max(0, Math.min(pos, max));
  const $p = doc.resolve(p);
  if ($p.parent.inlineContent) return p;
  return Selection.near($p, 1).from;
}

export interface Resolved {
  s: Suggestion;
  /** Deletion range (delete/replace). */
  from: number | null;
  to: number | null;
  /** Where inserted text goes (insert/replace). */
  at: number | null;
  /** The text it deletes has been edited since it was suggested. */
  stale: boolean;
  /** Its text is gone entirely. */
  gone: boolean;
}

export function resolveSuggestion(state: EditorState, s: Suggestion): Resolved {
  if (s.kind === "insert") {
    const at = resolveAnchor(state, s.anchor_from);
    return { s, from: null, to: null, at, stale: false, gone: at === null };
  }
  const from = resolveAnchor(state, s.anchor_from);
  const to = s.anchor_to ? resolveAnchor(state, s.anchor_to) : null;
  if (from === null || to === null || to < from) {
    return { s, from: null, to: null, at: null, stale: true, gone: true };
  }
  const now = state.doc.textBetween(from, to, "\n");
  const gone = to === from && s.quote.length > 0;
  return { s, from, to, at: s.kind === "replace" ? to : null, stale: now !== s.quote, gone };
}

// ─── decorations ────────────────────────────────────────────────────────────

function widget(s: Suggestion, mine: boolean, picked: boolean) {
  return () => {
    const el = document.createElement("span");
    el.className = `sugg-ins${mine ? " sugg-mine" : ""}${picked ? " sugg-picked" : ""}`;
    el.dataset.sugg = s.id;
    el.title = `${s.author_name || "Someone"} suggests adding this`;
    el.textContent = s.body.replace(/\n/g, " ¶ ");
    return el;
  };
}

function decorations(state: EditorState, opts: SuggestOptions): DecorationSet {
  const picked = suggestKey.getState(state)?.picked ?? null;
  const decos: Decoration[] = [];
  for (const s of opts.store.open()) {
    const r = resolveSuggestion(state, s);
    if (r.gone && r.at === null) continue;
    const mine = s.author_id === opts.me.id;
    const cls = `${mine ? " sugg-mine" : ""}${picked === s.id ? " sugg-picked" : ""}${r.stale ? " sugg-stale" : ""}`;
    if (r.from !== null && r.to !== null && r.to > r.from) {
      decos.push(
        Decoration.inline(r.from, r.to, {
          class: `sugg-del${cls}`,
          "data-sugg": s.id,
          title: `${s.author_name || "Someone"} suggests deleting this`,
        }),
      );
      if (s.quote.includes("\n")) {
        decos.push(Decoration.widget(r.from, widgetMark(s.id, "¶", `sugg-del${cls}`), { side: 1, key: `${s.id}:para` }));
      }
    }
    if (r.at !== null && s.body) {
      // side -1: drawn before a caret sitting at the same spot, so typing continues after it.
      decos.push(
        Decoration.widget(r.at, widget(s, mine, picked === s.id), {
          side: -1,
          key: `${s.id}:${s.version}:${picked === s.id}`,
          marks: [],
        }),
      );
    }
  }
  return DecorationSet.create(state.doc, decos);
}

function widgetMark(id: string, text: string, cls: string) {
  return () => {
    const el = document.createElement("span");
    el.className = cls;
    el.dataset.sugg = id;
    el.textContent = text;
    return el;
  };
}

// ─── suggesting ─────────────────────────────────────────────────────────────

function newId() {
  return crypto.randomUUID();
}

function base(opts: SuggestOptions, kind: Suggestion["kind"]): Suggestion {
  return {
    id: newId(),
    piece_id: opts.pieceId,
    author_id: opts.me.id,
    author_name: opts.me.name,
    source: "person",
    kind,
    anchor_from: "",
    anchor_to: null,
    quote: "",
    body: "",
    status: "open",
    version: 0,
    created_at: new Date().toISOString(),
  };
}

function mine(opts: SuggestOptions) {
  return opts.store.open().filter((s) => s.author_id === opts.me.id);
}

/** My insertion (or replacement) whose text goes in at `pos`, newest first. */
function myInsertAt(state: EditorState, opts: SuggestOptions, pos: number): Suggestion | null {
  const found = mine(opts)
    .filter((s) => s.kind !== "delete")
    .filter((s) => resolveSuggestion(state, s).at === pos)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return found[0] ?? null;
}

function myDeleteWhere(state: EditorState, opts: SuggestOptions, test: (r: Resolved) => boolean): Suggestion | null {
  for (const s of mine(opts)) {
    if (s.kind !== "delete") continue;
    const r = resolveSuggestion(state, s);
    if (!r.gone && test(r)) return s;
  }
  return null;
}

function moveCaret(view: EditorView, pos: number) {
  const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, pos));
  view.dispatch(tr.setMeta("addToHistory", false).setMeta(suggestKey, { refresh: true }));
}

/**
 * The caret as the browser has it right now. ProseMirror learns about caret moves from
 * "selectionchange" events, which can arrive after the next keystroke; suggest mode never lets
 * the browser change the text, so it must not act on a stale caret.
 */
function liveSelection(view: EditorView): { from: number; to: number } {
  const fallback = { from: view.state.selection.from, to: view.state.selection.to };
  const root = view.root as Document | ShadowRoot;
  const sel = "getSelection" in root && root.getSelection ? root.getSelection() : null;
  if (!sel || !sel.anchorNode || !sel.focusNode || !view.dom.contains(sel.anchorNode)) return fallback;
  try {
    const a = view.posAtDOM(sel.anchorNode, sel.anchorOffset);
    const b = view.posAtDOM(sel.focusNode, sel.focusOffset);
    return { from: Math.min(a, b), to: Math.max(a, b) };
  } catch {
    return fallback;
  }
}

/** Bring ProseMirror's selection up to date with the browser's before acting on it. */
function syncSelection(view: EditorView) {
  const { from, to } = liveSelection(view);
  const cur = view.state.selection;
  if (cur.from === from && cur.to === to) return;
  try {
    const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to));
    view.dispatch(tr.setMeta("addToHistory", false));
  } catch {
    // A position outside text: leave the selection alone.
  }
}

/** In test builds, a record of each suggesting keystroke (see e2e/). */
function trace(entry: Record<string, unknown>) {
  if (process.env.NEXT_PUBLIC_E2E !== "1" || typeof window === "undefined") return;
  const w = window as unknown as { __suggestLog?: unknown[] };
  (w.__suggestLog ??= []).push(entry);
}

export function suggestText(view: EditorView, opts: SuggestOptions, from: number, to: number, text: string) {
  const { state } = view;
  const { store } = opts;
  trace({
    text,
    from,
    to,
    sel: [state.selection.from, state.selection.to],
    size: state.doc.content.size,
    mine: mine(opts).map((s) => ({ body: s.body, kind: s.kind, at: resolveSuggestion(state, s).at })),
  });
  if (from === to) {
    const s = myInsertAt(state, opts, from);
    if (s) {
      store.put({ ...s, body: s.body + text });
    } else {
      store.put({ ...base(opts, "insert"), anchor_from: anchorAt(state, from, -1), body: text });
    }
    // The text doesn't change, so the caret stays; say so, so a redraw can't move it.
    moveCaret(view, from);
    return;
  }
  store.put({
    ...base(opts, "replace"),
    anchor_from: anchorAt(state, from, 0),
    anchor_to: anchorAt(state, to, -1),
    quote: state.doc.textBetween(from, to, "\n"),
    body: text,
  });
  moveCaret(view, to);
}

function suggestDelete(view: EditorView, opts: SuggestOptions, from: number, to: number, caret: number) {
  const { state } = view;
  if (to <= from) return;
  opts.store.put({
    ...base(opts, "delete"),
    anchor_from: anchorAt(state, from, 0),
    anchor_to: anchorAt(state, to, -1),
    quote: state.doc.textBetween(from, to, "\n"),
  });
  moveCaret(view, caret);
}

/** The position one character (or one paragraph break) before or after `pos`. */
function step(state: EditorState, pos: number, dir: -1 | 1): number | null {
  const $p = state.doc.resolve(pos);
  if (dir < 0 && $p.parentOffset > 0) {
    const before = state.doc.textBetween(pos - 2 >= $p.start() ? pos - 2 : pos - 1, pos);
    return /[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(before) ? pos - 2 : pos - 1;
  }
  if (dir > 0 && $p.parentOffset < $p.parent.content.size) {
    const after = state.doc.textBetween(pos, Math.min(pos + 2, $p.end()));
    return /^[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(after) ? pos + 2 : pos + 1;
  }
  // Across a paragraph boundary.
  const edge = dir < 0 ? $p.before() : $p.after();
  if (edge <= 0 || edge >= state.doc.content.size) return null;
  const next = Selection.findFrom(state.doc.resolve(edge), dir, true);
  return next ? next.from : null;
}

export function suggestBackspace(view: EditorView, opts: SuggestOptions) {
  const { state } = view;
  const sel = state.selection;
  trace({ key: "Backspace", sel: [sel.from, sel.to], size: state.doc.content.size });
  if (!sel.empty) return suggestDelete(view, opts, sel.from, sel.to, sel.from);
  const pos = sel.from;
  const ins = myInsertAt(state, opts, pos);
  if (ins && ins.body) {
    const body = Array.from(ins.body).slice(0, -1).join("");
    if (body) opts.store.put({ ...ins, body });
    else if (ins.kind === "insert") opts.store.remove(ins.id);
    else opts.store.put({ ...ins, kind: "delete", body: "" });
    return;
  }
  const prev = step(state, pos, -1);
  if (prev === null) return;
  const d = myDeleteWhere(state, opts, (r) => r.from === pos);
  if (d) {
    opts.store.put({
      ...d,
      anchor_from: anchorAt(state, prev, 0),
      quote: state.doc.textBetween(prev, pos, "\n") + d.quote,
    });
    moveCaret(view, prev);
    return;
  }
  suggestDelete(view, opts, prev, pos, prev);
}

export function suggestForwardDelete(view: EditorView, opts: SuggestOptions) {
  const { state } = view;
  const sel = state.selection;
  if (!sel.empty) return suggestDelete(view, opts, sel.from, sel.to, sel.to);
  const pos = sel.from;
  const next = step(state, pos, 1);
  if (next === null) return;
  const d = myDeleteWhere(state, opts, (r) => r.to === pos);
  if (d) {
    opts.store.put({
      ...d,
      anchor_to: anchorAt(state, next, -1),
      quote: d.quote + state.doc.textBetween(pos, next, "\n"),
    });
    moveCaret(view, next);
    return;
  }
  suggestDelete(view, opts, pos, next, next);
}

// ─── accepting (the student) ────────────────────────────────────────────────

/** Insert text that may contain line breaks, splitting paragraphs. Returns the end position. */
function insertLines(tr: Transaction, at: number, text: string): number {
  let pos = at;
  text.split("\n").forEach((line, i) => {
    if (i > 0) {
      tr.split(pos);
      pos = tr.mapping.map(pos, 1);
      pos = Selection.near(tr.doc.resolve(pos), 1).from;
    }
    if (line) {
      tr.insertText(line, pos);
      pos += line.length;
    }
  });
  return pos;
}

/**
 * Apply a suggestion to the text as the student's own edit. Returns false if its text is gone.
 */
export function acceptInto(view: EditorView, s: Suggestion): boolean {
  const r = resolveSuggestion(view.state, s);
  const tr = view.state.tr;
  if (s.kind === "insert") {
    if (r.at === null) return false;
    insertLines(tr, r.at, s.body);
  } else {
    if (r.from === null || r.to === null) return false;
    tr.delete(r.from, r.to);
    if (s.kind === "replace" && s.body) {
      const at = clampToText(tr.doc, tr.mapping.map(r.from, -1));
      insertLines(tr, at, s.body);
    }
  }
  view.dispatch(tr);
  return true;
}

// ─── the plugin ─────────────────────────────────────────────────────────────

export function suggestPlugin(opts: SuggestOptions): Plugin {
  const suggesting = opts.mode === "suggest";
  return new Plugin({
    key: suggestKey,
    state: {
      init: (): { tick: number; picked: string | null } => ({ tick: 0, picked: null }),
      apply(tr, value) {
        const meta = tr.getMeta(suggestKey) as { refresh?: boolean; pick?: string | null } | undefined;
        if (!meta) return value;
        return { tick: value.tick + 1, picked: meta.pick !== undefined ? meta.pick : value.picked };
      },
    },
    view(view) {
      const unsubscribe = opts.store.subscribe(() => {
        if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(suggestKey, { refresh: true }).setMeta("addToHistory", false));
      });
      return { destroy: unsubscribe };
    },
    // In suggest and view modes, only other people's edits (arriving through Yjs) reach the text.
    filterTransaction(tr) {
      if (opts.mode === "owner" || !tr.docChanged) return true;
      return isChangeOrigin(tr);
    },
    props: {
      decorations: (state) => decorations(state, opts),
      editable: () => opts.mode !== "view",
      handleTextInput(view, from, to, text) {
        if (!suggesting) return opts.mode === "view";
        suggestText(view, opts, from, to, text);
        return true;
      },
      handleKeyDown(view, event) {
        if (opts.mode === "owner") return false;
        const mod = event.metaKey || event.ctrlKey;
        if (!suggesting) return !isNavigation(event, mod);
        syncSelection(view);
        if (mod && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) opts.store.redo();
          else opts.store.undo();
          return true;
        }
        if (mod && event.key.toLowerCase() === "y") {
          event.preventDefault();
          opts.store.redo();
          return true;
        }
        if (event.key === "Backspace") {
          suggestBackspace(view, opts);
          return true;
        }
        if (event.key === "Delete") {
          suggestForwardDelete(view, opts);
          return true;
        }
        if (event.key === "Enter") {
          const { from, to } = view.state.selection;
          suggestText(view, opts, from, to, "\n");
          return true;
        }
        // Formatting shortcuts would change the text.
        if (mod && !isNavigation(event, mod)) return true;
        return false;
      },
      handleDOMEvents: {
        // Take typed text before the browser puts it in the page: the page's text must not change.
        beforeinput(view, event) {
          if (opts.mode === "owner") return false;
          const e = event as InputEvent;
          if (e.inputType !== "insertText" && e.inputType !== "insertReplacementText") return false;
          e.preventDefault();
          if (!suggesting) return true;
          const text = e.data ?? e.dataTransfer?.getData("text/plain") ?? "";
          const { from, to } = liveSelection(view);
          if (text) suggestText(view, opts, from, to, text);
          return true;
        },
      },
      handlePaste(view, _event, slice) {
        if (opts.mode === "owner") return false;
        if (!suggesting) return true;
        const text = slice.content.textBetween(0, slice.content.size, "\n");
        const { from, to } = view.state.selection;
        if (text) suggestText(view, opts, from, to, text);
        return true;
      },
      handleDrop: () => opts.mode !== "owner",
      handleClickOn(view, _pos, _node, _nodePos, event) {
        const el = (event.target as HTMLElement | null)?.closest?.("[data-sugg]") as HTMLElement | null;
        if (!el?.dataset.sugg) return false;
        opts.onPick?.(el.dataset.sugg);
        view.dispatch(view.state.tr.setMeta(suggestKey, { pick: el.dataset.sugg }));
        return false;
      },
    },
  });
}

function isNavigation(e: KeyboardEvent, mod: boolean) {
  if (mod && ["a", "c"].includes(e.key.toLowerCase())) return true;
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Tab", "Escape", "Shift", "Control", "Meta", "Alt"].includes(e.key);
}
