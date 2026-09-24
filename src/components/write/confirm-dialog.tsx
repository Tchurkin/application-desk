"use client";

import { useId, useState } from "react";
import { Modal } from "./modal";

/**
 * Asks before something that can't be undone, in the page (browser dialogs can be blocked).
 * The confirm button has focus, so Enter confirms; Escape or the backdrop cancels.
 */
export function ConfirmDialog({
  question,
  detail,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  question: string;
  detail?: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const id = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal role="alertdialog" labelledBy={`${id}-q`} describedBy={detail ? `${id}-d` : undefined} onClose={() => !pending && onCancel()}>
      <div className="flex flex-col gap-3 p-5">
        <p id={`${id}-q`} className="font-medium">{question}</p>
        {detail && <p id={`${id}-d`} className="text-sm text-muted">{detail}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn" disabled={pending} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-autofocus
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(null);
              try {
                await onConfirm();
              } catch (e) {
                // A redirect from a server action is not a failure: the page is already leaving.
                if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) return;
                setError((e as Error).message || "That didn't work. Try again.");
                setPending(false);
              }
            }}
          >
            {pending ? `${confirmLabel}…` : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
