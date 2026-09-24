"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import type { SuggestionStore } from "@/lib/suggest/store";
import { BulletIcon, NumberedIcon, QuoteIcon, RedoIcon, UndoIcon } from "./icons";
import { moveFocusInToolbar } from "./workspace";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

function Tool({
  label,
  hint,
  pressed,
  disabled,
  onRun,
  children,
}: {
  label: string;
  hint: string;
  pressed?: boolean;
  disabled?: boolean;
  onRun: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={hint}
      disabled={disabled}
      // Keep the selection in the essay: act on click, but never take focus on mousedown.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-sm disabled:opacity-40 ${
        pressed ? "bg-accent-soft text-accent" : "text-muted hover:bg-bg hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Bold, italic, underline, lists and quotes for the writer; undo and redo for everyone who can
 * change anything. Someone suggesting gets only undo and redo, of their suggestions: formatting
 * would change the writer's text, which only the writer does.
 */
export function FormatToolbar({ editor, mode, store }: { editor: Editor; mode: "owner" | "suggest"; store: SuggestionStore }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullets: e.isActive("bulletList"),
      numbers: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      canUndo: mode === "owner" ? e.can().undo() : true,
      canRedo: mode === "owner" ? e.can().redo() : true,
    }),
  });
  const chain = () => editor.chain().focus();
  const owner = mode === "owner";

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={(e) => moveFocusInToolbar(e, ["ArrowLeft", "ArrowRight"])}
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-line bg-panel px-1 py-0.5"
    >
      {owner && (
        <>
          <Tool label="Bold" hint={`Bold (${MOD}B)`} pressed={state.bold} onRun={() => chain().toggleBold().run()}>
            <b>B</b>
          </Tool>
          <Tool label="Italic" hint={`Italic (${MOD}I)`} pressed={state.italic} onRun={() => chain().toggleItalic().run()}>
            <i className="font-serif">I</i>
          </Tool>
          <Tool label="Underline" hint={`Underline (${MOD}U)`} pressed={state.underline} onRun={() => chain().toggleUnderline().run()}>
            <u>U</u>
          </Tool>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <Tool label="Bulleted list" hint={`Bulleted list (${MOD}Shift+8)`} pressed={state.bullets} onRun={() => chain().toggleBulletList().run()}>
            <BulletIcon />
          </Tool>
          <Tool label="Numbered list" hint={`Numbered list (${MOD}Shift+7)`} pressed={state.numbers} onRun={() => chain().toggleOrderedList().run()}>
            <NumberedIcon />
          </Tool>
          <Tool label="Quote" hint={`Quote (${MOD}Shift+B)`} pressed={state.quote} onRun={() => chain().toggleBlockquote().run()}>
            <QuoteIcon />
          </Tool>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        </>
      )}
      <Tool
        label="Undo"
        hint={`Undo (${MOD}Z)`}
        disabled={!state.canUndo}
        onRun={() => (owner ? chain().undo().run() : (store.undo(), editor.commands.focus()))}
      >
        <UndoIcon />
      </Tool>
      <Tool
        label="Redo"
        hint={`Redo (${MOD}Y)`}
        disabled={!state.canRedo}
        onRun={() => (owner ? chain().redo().run() : (store.redo(), editor.commands.focus()))}
      >
        <RedoIcon />
      </Tool>
      {!owner && <span className="px-2 text-xs text-muted">Formatting is off while suggesting.</span>}
    </div>
  );
}
