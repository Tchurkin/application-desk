"use client";

import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A dialog over the page: Escape or a click on the backdrop closes it, Tab stays inside it,
 * and focus goes back where it was when it closes. The element marked data-autofocus (else the
 * first focusable one) gets focus when it opens.
 */
export function Modal({
  label,
  labelledBy,
  describedBy,
  role = "dialog",
  onClose,
  children,
  className = "",
  placement = "center",
}: {
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: "center" | "top" | "fill";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = panel.current;
    const first = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    return () => {
      if (before && document.contains(before)) before.focus();
    };
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      e.preventDefault();
      close.current();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const place =
    placement === "fill"
      ? "inset-2 sm:inset-6"
      : placement === "top"
        ? "left-1/2 top-[12vh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2"
        : "left-1/2 top-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2";

  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-ink/30" aria-hidden onClick={() => close.current()} />
      <div
        ref={panel}
        role={role}
        aria-modal="true"
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`card absolute flex flex-col shadow-xl outline-none ${place} ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
