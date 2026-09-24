import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/*
 * Keep a highlighted passage visible after the editor loses focus, for example when the student
 * clicks into the Ask box to ask about it. The browser hides a selection in a blurred editor, so
 * the range is drawn as an amber highlight until the student comes back to the editor. It
 * follows edits (other people's typing moves it with the words).
 */

type Held = { from: number; to: number } | null;

export const heldSelectionKey = new PluginKey<Held>("held-selection");

/** The held range, if any. */
export function heldRange(state: EditorState): Held {
  return heldSelectionKey.getState(state) ?? null;
}

export function heldSelectionPlugin(): Plugin<Held> {
  return new Plugin<Held>({
    key: heldSelectionKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const meta = tr.getMeta(heldSelectionKey) as Held | undefined;
        if (meta !== undefined) return meta;
        if (!value || !tr.docChanged) return value;
        const from = tr.mapping.map(value.from, 1);
        const to = tr.mapping.map(value.to, -1);
        return from < to ? { from, to } : null;
      },
    },
    props: {
      decorations(state) {
        const held = heldSelectionKey.getState(state);
        if (!held) return null;
        return DecorationSet.create(state.doc, [Decoration.inline(held.from, held.to, { class: "held-selection" })]);
      },
      handleDOMEvents: {
        blur(view) {
          const { from, to, empty } = view.state.selection;
          if (!empty && !view.isDestroyed) {
            view.dispatch(view.state.tr.setMeta(heldSelectionKey, { from, to }).setMeta("addToHistory", false));
          }
          return false;
        },
        focus(view) {
          if (heldSelectionKey.getState(view.state)) {
            view.dispatch(view.state.tr.setMeta(heldSelectionKey, null).setMeta("addToHistory", false));
          }
          return false;
        },
      },
    },
  });
}

export const HeldSelection = Extension.create({
  name: "heldSelection",
  addProseMirrorPlugins: () => [heldSelectionPlugin()],
});
