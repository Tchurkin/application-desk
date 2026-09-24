"use client";
import { useActionState, useState } from "react";
import { createConnectorLink, type ConnectorState } from "../connector-actions";

export function ConnectorCreator() {
  const [state, action, pending] = useActionState<ConnectorState, FormData>(createConnectorLink, {});
  const [copied, setCopied] = useState(false);
  const url = state.token && typeof window !== "undefined" ? `${window.location.origin}/api/mcp/${state.token}` : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="assistant">Assistant</label>
          <select className="field" id="assistant" name="assistant" defaultValue="Claude">
            <option value="Claude">Claude</option>
            <option value="ChatGPT">ChatGPT</option>
          </select>
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Making link…" : "Make a connector link"}
        </button>
      </form>
      {state.error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {url && (
        <div className="rounded-md border border-accent bg-accent-soft px-3 py-3 text-sm" data-testid="new-connector">
          <p className="mb-2 font-medium">Your {state.label} connector link. Copy it now: it won&apos;t be shown again.</p>
          <div className="mb-3 flex gap-2">
            <input className="field font-mono text-xs" readOnly value={url} aria-label="Connector link" onFocus={(e) => e.target.select()} />
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
          {state.label === "ChatGPT" ? (
            <ol className="list-decimal pl-5">
              <li>Needs ChatGPT Plus or higher. On chatgpt.com, open Settings → Apps → Advanced settings and turn on Developer mode.</li>
              <li>Choose Create app, name it Application Desk, paste the link, and pick No authentication.</li>
              <li>In a chat, add the Application Desk app from the + menu, then ask something like &quot;Read my Why Northfield essay and suggest edits.&quot;</li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5">
              <li>Works on any Claude plan, including free. On claude.ai or the Claude desktop app, open Settings → Connectors.</li>
              <li>Choose Add custom connector, name it Application Desk, and paste the link.</li>
              <li>In a chat, turn Application Desk on from the tools menu, then ask something like &quot;Read my Why Northfield essay and suggest edits.&quot;</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
