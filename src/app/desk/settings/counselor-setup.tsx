"use client";
import { useState, useSyncExternalStore } from "react";
import { downloadInstaller } from "@/lib/counselor/download";
import { INSTALLER_NAME } from "@/lib/counselor/installer";
import type { EssayAccess } from "@/lib/domain/share";
import { createCounselorLink } from "../connector-actions";
import { PermissionFields } from "./connector-creator";

export const isWindows = () => /Windows/i.test(navigator.userAgent);

/** What to do with the downloaded file. */
export function InstallSteps() {
  return (
    <ol className="list-decimal rounded-md border border-accent bg-accent-soft py-3 pr-3 pl-8 text-sm" data-testid="counselor-steps">
      <li>
        Open the downloaded file, <span className="font-medium">{INSTALLER_NAME}</span>. If Windows warns you, choose More info → Run
        anyway (it&apos;s a script this site wrote for you; it installs nothing from the internet).
      </li>
      <li>Wait a few seconds for “Your counselor is on.”</li>
      <li>That&apos;s it. Ask anything on your desk and the answer shows up there, now and every time you sign in.</li>
    </ol>
  );
}

/**
 * Set up Claude Code on this computer as the student's counselor: one download, one
 * double-click. See src/lib/counselor/installer.ts for what the file does.
 */
export function CounselorSetup({ withPermissions = true }: { withPermissions?: boolean }) {
  const windows = useSyncExternalStore(
    () => () => {},
    isWindows,
    () => true,
  );
  const [essays, setEssays] = useState<EssayAccess>("edit");
  const [manage, setManage] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const r = await createCounselorLink(essays, manage);
      if (r.error || !r.token) throw new Error(r.error ?? "No link was made.");
      downloadInstaller(r.token);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="counselor-setup">
      {withPermissions && (
        <PermissionFields idPrefix="counselor" essays={essays} manage={manage} onEssays={setEssays} onManage={setManage} />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void download()}>
          {busy ? "Preparing…" : "Download the counselor for Windows"}
        </button>
        {!windows && <span className="text-xs text-warn">This runs on Windows. On a Mac, use a Claude chat with “Watch my Application Desk”.</span>}
      </div>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {done && <InstallSteps />}
    </div>
  );
}
