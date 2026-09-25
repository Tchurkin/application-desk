"use client";
import Link from "next/link";
import { useState } from "react";
import { LocalDay } from "@/components/local-day";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteForever, restoreFromTrash } from "./actions";

export interface TrashItem {
  id: string;
  kind: "piece" | "college";
  title: string;
  detail: string;
  deleted_by: string;
  deleted_at: string;
  /** Days left before it's deleted for good. */
  daysLeft: number;
}


export function TrashList({ items }: { items: TrashItem[] }) {
  const [restored, setRestored] = useState<{ title: string; href: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(item: TrashItem) {
    setBusy(item.id);
    setError(null);
    const r = await restoreFromTrash(item.id);
    setBusy(null);
    if (!r.ok) return setError(`Couldn't restore “${item.title}”. ${r.error}`);
    setRestored({ title: item.title, href: r.kind === "college" ? `/desk/college/${r.id}` : `/desk/piece/${r.id}` });
  }

  return (
    <div className="flex flex-col gap-3">
      {restored && (
        <p role="status" className="rounded-md border border-accent bg-accent-soft px-3 py-2 text-sm">
          “{restored.title}” is back.{" "}
          <Link href={restored.href} className="font-medium underline underline-offset-2">
            Open it
          </Link>
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="card px-4 py-6 text-sm text-muted">The Trash is empty.</p>
      ) : (
        <ul aria-label="Trash" className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="card flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm" data-testid="trash-item">
              <span className="min-w-0">
                <span className="font-medium">{item.title || "Untitled"}</span>
                <span className="text-muted">
                  {" · "}
                  {item.kind === "college" ? `college, ${item.detail}` : item.detail ? `piece for ${item.detail}` : "independent piece"}
                </span>
                <span className="block text-xs text-muted">
                  Deleted <LocalDay at={item.deleted_at} />
                  {item.deleted_by ? ` by ${item.deleted_by}` : ""} · kept {item.daysLeft} more day{item.daysLeft === 1 ? "" : "s"}
                </span>
              </span>
              <span className="flex gap-2">
                <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void restore(item)}>
                  {busy === item.id ? "Restoring…" : "Restore"}
                </button>
                <ConfirmButton
                  label="Delete forever"
                  confirmLabel="Delete forever"
                  question={`Delete “${item.title || "Untitled"}” for good? This can't be undone.`}
                  onConfirm={async () => {
                    const r = await deleteForever(item.id);
                    if (r.error) setError(r.error);
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
