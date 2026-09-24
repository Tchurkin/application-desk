"use client";
import { useState, useTransition } from "react";

/** A delete button that asks in the page, not in a browser dialog. */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "Delete",
  onConfirm,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <button type="button" className="btn btn-danger" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span role="alertdialog" aria-label={question} className="inline-flex flex-wrap items-center gap-2 rounded-md bg-danger-soft px-3 py-1.5 text-sm">
      <span>{question}</span>
      <button type="button" className="btn btn-danger" disabled={pending} onClick={() => start(onConfirm)}>
        {pending ? "Deleting…" : confirmLabel}
      </button>
      <button type="button" className="btn" disabled={pending} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
