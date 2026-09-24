"use client";
import { useActionState, useState } from "react";
import { createShareLink, type CreateLinkState } from "../share-actions";

export function ShareCreator() {
  const [state, action, pending] = useActionState<CreateLinkState, FormData>(createShareLink, {});
  const [copied, setCopied] = useState(false);
  const url = state.token && typeof window !== "undefined" ? `${window.location.origin}/join/${state.token}` : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="label">Who is it for?</label>
          <input className="field" id="label" name="label" placeholder="e.g. Mom" maxLength={80} />
        </div>
        <div>
          <label className="label" htmlFor="role">They can</label>
          <select className="field" id="role" name="role" defaultValue="suggest">
            <option value="suggest">Read and suggest edits</option>
            <option value="view">Only read</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="share-password">Password (optional)</label>
          <input className="field" id="share-password" name="password" type="password" autoComplete="new-password" />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Making link…" : "Make a share link"}
          </button>
        </div>
      </form>
      {state.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {url && (
        <div className="rounded-md border border-accent bg-accent-soft px-3 py-3 text-sm" data-testid="new-link">
          <p className="mb-2 font-medium">
            Link{state.label ? ` for ${state.label}` : ""} ({state.role === "suggest" ? "can suggest" : "read only"}). Copy it now:
            it won&apos;t be shown again.
          </p>
          <div className="flex gap-2">
            <input className="field font-mono text-xs" readOnly value={url} aria-label="Share link" onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
