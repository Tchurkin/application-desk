import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { insertLines } from "@/lib/editor/insert-lines";
import { DIRECT_EDIT } from "@/lib/suggest/plugin";
import { docText } from "@/lib/suggest/doc-text";
import { findText } from "@/lib/suggest/loose";
import { heldRange } from "./held-selection";

/*
 * Rewrites shown in place: when the counselor answers "make this better" about a highlighted
 * passage with a few versions, the passage in the essay is shown as the first version. ← and →
 * (or ↑ and ↓) cycle through them, Enter keeps the one showing, Esc puts the original back. The
 * Ask panel offers them through a small bus; the editor for that piece picks them up.
 */

export interface RewriteOffer {
  pieceId: string;
  requestId: string;
  passage: string;
  options: string[];
  index: number;
}

export type RewriteEvent =
  | { type: "shown"; requestId: string; index: number }
  | { type: "accepted"; requestId: string; index: number }
  | { type: "closed"; requestId: string }
  | { type: "missing"; requestId: string };

const offerListeners = new Set<(o: RewriteOffer) => void>();
const eventListeners = new Set<(e: RewriteEvent) => void>();

/** Show a request's rewrites in the essay (the editor open on that piece takes it). */
export function offerRewrites(o: RewriteOffer) {
  offerListeners.forEach((l) => l(o));
}

/** What happened to offered rewrites: shown, accepted, closed, or the passage couldn't be found. */
export function onRewriteEvent(l: (e: RewriteEvent) => void): () => void {
  eventListeners.add(l);
  return () => eventListeners.delete(l);
}

const emit = (e: RewriteEvent) => eventListeners.forEach((l) => l(e));

interface Showing {
  requestId: string;
  from: number;
  to: number;
  options: string[];
  index: number;
}

type Meta = { show: Showing } | { index: number } | { close: true };

export const rewritesKey = new PluginKey<Showing | null>("rewrites");

export function showingRewrite(state: EditorState): Showing | null {
  return rewritesKey.getState(state) ?? null;
}

/** Where a passage is in the document: near the held selection when it appears more than once. */
export function locate(state: EditorState, passage: string): { from: number; to: number } | null {
  const dt = docText(state.doc);
  const held = heldRange(state);
  const near = held ? dt.offsetOf(held.from) : undefined;
  const found = findText(dt.hay, passage.replace(/\r\n?/g, "\n"), near);
  if ("error" in found) return null;
  return { from: dt.posFrom(found.start), to: dt.posTo(found.end) };
}

function widget(s: Showing) {
  return () => {
    const wrap = document.createElement("span");
    wrap.className = "rewrite-new";
    wrap.setAttribute("data-testid", "rewrite-preview");
    const lines = s.options[s.index].split("\n");
    lines.forEach((line, i) => {
      if (i) wrap.appendChild(document.createElement("br"));
      wrap.appendChild(document.createTextNode(line));
    });
    const hint = document.createElement("span");
    hint.className = "rewrite-hint";
    hint.contentEditable = "false";
    hint.textContent = `${s.index + 1}/${s.options.length} · ← → switch · Enter keep · Esc undo`;
    wrap.appendChild(hint);
    return wrap;
  };
}

function accept(view: EditorView, s: Showing) {
  const tr = view.state.tr.delete(s.from, s.to);
  insertLines(tr, s.from, s.options[s.index]);
  view.dispatch(tr.setMeta(rewritesKey, { close: true } satisfies Meta).setMeta(DIRECT_EDIT, true));
  emit({ type: "accepted", requestId: s.requestId, index: s.index });
}

export function rewritesPlugin(pieceId: string): Plugin<Showing | null> {
  return new Plugin<Showing | null>({
    key: rewritesKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(rewritesKey) as Meta | undefined;
        if (meta && "show" in meta) return meta.show;
        if (meta && "close" in meta) return null;
        if (!value) return value;
        if (meta && "index" in meta) return { ...value, index: meta.index };
        if (!tr.docChanged) return value;
        // Someone else edited: the passage moves with its words, or the preview goes if they're gone.
        const from = tr.mapping.map(value.from, 1);
        const to = tr.mapping.map(value.to, -1);
        return from < to ? { ...value, from, to } : null;
      },
    },
    view(view) {
      const off = (() => {
        const listener = (o: RewriteOffer) => {
          if (o.pieceId !== pieceId || view.isDestroyed || !o.options.length) return;
          const at = locate(view.state, o.passage);
          if (!at) return emit({ type: "missing", requestId: o.requestId });
          const show: Showing = { requestId: o.requestId, ...at, options: o.options, index: Math.min(o.index, o.options.length - 1) };
          view.dispatch(view.state.tr.setMeta(rewritesKey, { show } satisfies Meta).setMeta("addToHistory", false));
          view.focus();
          emit({ type: "shown", requestId: o.requestId, index: show.index });
        };
        offerListeners.add(listener);
        return () => offerListeners.delete(listener);
      })();
      return { destroy: off };
    },
    props: {
      decorations(state) {
        const s = rewritesKey.getState(state);
        if (!s) return null;
        return DecorationSet.create(state.doc, [
          Decoration.inline(s.from, s.to, { class: "rewrite-old" }),
          Decoration.widget(s.to, widget(s), { side: 1, key: `rewrite-${s.requestId}-${s.index}` }),
        ]);
      },
      handleKeyDown(view, event) {
        const s = rewritesKey.getState(view.state);
        if (!s) return false;
        const step = (d: number) => {
          const index = (s.index + d + s.options.length) % s.options.length;
          view.dispatch(view.state.tr.setMeta(rewritesKey, { index } satisfies Meta).setMeta("addToHistory", false));
          emit({ type: "shown", requestId: s.requestId, index });
        };
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          step(1);
          return true;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          step(-1);
          return true;
        }
        if (event.key === "Enter") {
          accept(view, s);
          return true;
        }
        if (event.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(rewritesKey, { close: true } satisfies Meta).setMeta("addToHistory", false));
          emit({ type: "closed", requestId: s.requestId });
          return true;
        }
        // Anything else (typing, shortcuts) puts the original back and carries on.
        if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
          view.dispatch(view.state.tr.setMeta(rewritesKey, { close: true } satisfies Meta).setMeta("addToHistory", false));
          emit({ type: "closed", requestId: s.requestId });
        }
        return false;
      },
    },
  });
}

export const Rewrites = (pieceId: string) =>
  Extension.create({
    name: "rewrites",
    // Ahead of the editor's own keys, so ← → and Enter reach it while a rewrite is showing.
    priority: 1000,
    addProseMirrorPlugins: () => [rewritesPlugin(pieceId)],
  });

/** Keep the option showing, from outside the editor (the Ask panel's buttons). */
export function acceptShowing(view: EditorView): boolean {
  const s = rewritesKey.getState(view.state);
  if (!s) return false;
  accept(view, s);
  return true;
}
