"use client";
import { useRef, useState, type TextareaHTMLAttributes } from "react";
import { AnswerText } from "@/components/ask/answer-text";

/*
 * A text box for writing that can carry simple formatting (**bold**, "- " lists), much of it
 * written by Claude: shown formatted, edited as plain text. The real text box is always there,
 * laid invisibly over the formatted view, so a click or Tab goes straight into it, and forms,
 * labels and saving work as they do for any text box.
 */
export function FormattedTextarea({ className = "", style, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [typed, setTyped] = useState(String(props.defaultValue ?? ""));
  const [editing, setEditing] = useState(false);
  // Opened for editing, the box keeps the formatted view's height instead of jumping back to its rows.
  const [height, setHeight] = useState<number | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const text = props.value !== undefined ? String(props.value) : typed;
  const formatted = !editing && text.trim() !== "";
  return (
    <div className="relative">
      {formatted && (
        <div ref={view} aria-hidden className={`${className} overflow-hidden`} data-testid="formatted-text">
          <AnswerText text={text} />
        </div>
      )}
      <textarea
        {...props}
        style={editing && height ? { ...style, minHeight: height } : style}
        className={formatted ? `${className} absolute inset-0 h-full w-full cursor-text resize-none opacity-0` : className}
        onChange={(e) => {
          if (props.value === undefined) setTyped(e.target.value);
          props.onChange?.(e);
        }}
        onFocus={(e) => {
          setHeight(view.current?.offsetHeight ?? null);
          setEditing(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setEditing(false);
          props.onBlur?.(e);
        }}
      />
    </div>
  );
}
