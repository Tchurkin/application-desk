"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A button that opens a small panel beside it. The panel closes on Escape, on a click outside
 * it, or when its content calls `close`; focus moves into it on open and back to the button on
 * close.
 */
export function Popover({
  label,
  trigger,
  triggerClassName,
  triggerLabel,
  align = "left",
  children,
}: {
  /** The panel's accessible name. */
  label: string;
  trigger: ReactNode;
  triggerClassName: string;
  /** The button's accessible name, when its content doesn't say it. */
  triggerLabel?: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    document.getElementById(`${id}-button`)?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input, button, select, textarea, [tabindex]")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span ref={box} className="relative inline-flex">
      <button
        id={`${id}-button`}
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className={triggerClassName}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={label}
          className={`absolute top-full z-40 mt-1 w-64 rounded-lg border border-line bg-panel p-3 text-sm text-ink shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          {children(close)}
        </div>
      )}
    </span>
  );
}
