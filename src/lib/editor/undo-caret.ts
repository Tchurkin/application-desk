import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

/**
 * Where the caret goes after Undo and Redo.
 *
 * Yjs undoes a deletion by inserting the text again as new characters, and y-prosemirror then
 * restores the caret next to the old, deleted ones, which leaves it in front of the restored
 * letter instead of after it. After an undo or redo, put the caret where a word processor
 * would: at the end of what came back, or where text was taken away.
 */
export const UndoCaret = Extension.create({
  name: "undoCaret",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("undoCaret"),
        appendTransaction(transactions, oldState, newState) {
          const undo = transactions.some(
            (tr) => tr.docChanged && (tr.getMeta(ySyncPluginKey) as { isUndoRedoOperation?: boolean } | undefined)?.isUndoRedoOperation,
          );
          if (!undo) return null;
          const start = oldState.doc.content.findDiffStart(newState.doc.content);
          if (start === null) return null;
          const end = oldState.doc.content.findDiffEnd(newState.doc.content);
          // findDiffEnd can report an end before the start when the change repeats nearby text.
          const added = end ? Math.max(end.b, start) : start;
          const pos = Math.min(added, newState.doc.content.size);
          const sel = TextSelection.near(newState.doc.resolve(pos), -1);
          if (sel.eq(newState.selection)) return null;
          return newState.tr.setSelection(sel).setMeta("addToHistory", false);
        },
      }),
    ];
  },
});
