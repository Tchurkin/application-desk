"use client";
import { useActionState, useState } from "react";
import { useNow } from "@/lib/bridge/use-now";
import { ESSAY_ACCESS, type EssayAccess } from "@/lib/domain/share";
import { createConnectorLink, setConnectorPermissions, type ConnectorState } from "../connector-actions";

/**
 * What a connector may do: its access to essays (read only / suggest / write) and whether it may
 * manage colleges and pieces. Controlled (onEssays/onManage given) or, in a form, uncontrolled
 * with the fields "essays" and "manage".
 */
export function PermissionFields({
  idPrefix,
  essays,
  manage,
  onEssays,
  onManage,
}: {
  idPrefix: string;
  essays?: EssayAccess;
  manage?: boolean;
  onEssays?: (v: EssayAccess) => void;
  onManage?: (v: boolean) => void;
}) {
  const controlled = onEssays !== undefined;
  const [own, setOwn] = useState<EssayAccess>("edit");
  const [ownManage, setOwnManage] = useState(true);
  const value = controlled ? (essays ?? "edit") : own;
  const managing = controlled ? !!manage : ownManage;
  const pick = (v: EssayAccess) => (controlled ? onEssays(v) : setOwn(v));
  return (
    <div className="flex flex-col gap-3" id={`${idPrefix}-permissions`}>
      <div>
        <p className="label" id={`${idPrefix}-essays`}>
          Essays
        </p>
        <div role="radiogroup" aria-labelledby={`${idPrefix}-essays`} className="inline-flex rounded-md border border-line bg-panel p-0.5 text-sm">
          {ESSAY_ACCESS.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={value === a.value}
              onClick={() => pick(a.value)}
              className={`rounded px-3 py-1 ${value === a.value ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
            >
              {a.short}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">{ESSAY_ACCESS.find((a) => a.value === value)?.about}</p>
        {!controlled && <input type="hidden" name="essays" value={value} />}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="manage"
          className="mt-0.5"
          checked={managing}
          onChange={(e) => (controlled ? onManage?.(e.target.checked) : setOwnManage(e.target.checked))}
        />
        <span>
          <span className="font-medium">Manage colleges and pieces</span>
          <span className="block text-xs text-muted">Add, change and remove colleges and pieces: details, prompts, word limits, due dates.</span>
        </span>
      </label>
    </div>
  );
}

export function ConnectorCreator() {
  const [state, action, pending] = useActionState<ConnectorState, FormData>(createConnectorLink, {});
  const [copied, setCopied] = useState(false);
  const url = state.token && typeof window !== "undefined" ? `${window.location.origin}/api/mcp/${state.token}` : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <div className="max-w-xs">
          <label className="label" htmlFor="assistant">Assistant</label>
          <select className="field" id="assistant" name="assistant" defaultValue="Claude">
            <option value="Claude">Claude</option>
            <option value="ChatGPT">ChatGPT</option>
          </select>
        </div>
        <PermissionFields idPrefix="new-connector" />
        <div>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? "Making link…" : "Make a connector link"}
          </button>
        </div>
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
              <li>Choose Create app, name it Average App, paste the link, and pick No authentication.</li>
              <li>In a chat, add Average App from the + menu, then ask something like &quot;Read my Why Northfield essay and suggest edits.&quot;</li>
            </ol>
          ) : (
            <ol className="list-decimal pl-5">
              <li>Works on any Claude plan, including free. On claude.ai or the Claude desktop app, open Settings → Connectors.</li>
              <li>Choose Add custom connector, name it Average App, and paste the link.</li>
              <li>In a chat, turn Average App on from the tools menu, then ask something like &quot;Read my Why Northfield essay and suggest edits.&quot;</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** A counselor checks in every 20 seconds or so while it runs. */
const COUNSELOR_FRESH_MS = 120_000;

/** Whether a link is in use: for the counselor, whether it is on right now. */
export function ConnectorStatus({ counselorAt, lastUsedAt }: { counselorAt: string | null; lastUsedAt: string | null }) {
  const now = useNow(15_000);
  if (counselorAt) {
    const on = now > 0 && now - Date.parse(counselorAt) < COUNSELOR_FRESH_MS;
    return (
      <span className="block text-xs text-muted">
        {on ? "On and watching your desk" : `Off since ${new Date(counselorAt).toLocaleString()} (it starts when you sign in to that computer)`}
      </span>
    );
  }
  return <span className="block text-xs text-muted">{lastUsedAt ? `Last used ${new Date(lastUsedAt).toLocaleString()}` : "Not used yet"}</span>;
}

/** Change what an existing connector may do; saved as soon as it changes. */
export function ConnectorPermissions({ id, essays, manage, label }: { id: string; essays: EssayAccess; manage: boolean; label: string }) {
  const [value, setValue] = useState({ essays, manage });
  const [error, setError] = useState<string | null>(null);
  const save = async (next: { essays: EssayAccess; manage: boolean }) => {
    const before = value;
    setValue(next);
    setError(null);
    try {
      await setConnectorPermissions(id, next.essays, next.manage);
    } catch (e) {
      setValue(before);
      setError((e as Error).message);
    }
  };
  return (
    <div className="mt-3 border-t border-line pt-3" role="group" aria-label={`What ${label} can do`}>
      <PermissionFields
        idPrefix={`connector-${id}`}
        essays={value.essays}
        manage={value.manage}
        onEssays={(v) => void save({ ...value, essays: v })}
        onManage={(v) => void save({ ...value, manage: v })}
      />
      {error && <p className="mt-2 text-xs text-danger">Couldn&apos;t change it: {error}</p>}
    </div>
  );
}
