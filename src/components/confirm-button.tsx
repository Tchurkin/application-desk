"use client";
import { useState, useTransition } from "react";

/** A delete button that asks in the page, not in a browser dialog. */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "Delete",
  onConfirm,
  quiet = false,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  /** A plain text button until pressed, for a page where it shouldn't catch the eye. */
  quiet?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <button
        type="button"
        className={quiet ? "text-sm text-muted underline-offset-2 hover:text-danger hover:underline" : "btn btn-danger"}
        onClick={() => setAsking(true)}
      >
        {label}
      </button>
    );
  }
  return (
    <span role="alertdialog" aria-label={question} className="inline-flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-1.5 text-sm">
      <span>{question}</span>
      <button type="button" className="btn btn-danger" disabled={pending} onClick={() => start(onConfirm)}>
        {pending ? `${confirmLabel}…` : confirmLabel}
      </button>
      <button type="button" className="btn" disabled={pending} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
