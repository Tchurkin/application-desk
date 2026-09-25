"use client";
import { useActionState } from "react";
import { setSharePassword, type SharePasswordState } from "../../share-actions";

/** One password for every share link: set, change or turn off. */
export function SharePassword({ on, olderLinks }: { on: boolean; olderLinks: number }) {
  const [state, action, pending] = useActionState<SharePasswordState, FormData>(setSharePassword, {});
  const isOn = state.saved ? state.saved === "set" : on;
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm">
        {isOn
          ? "On: anyone opening one of your links types this password the first time, on each device."
          : "Off: your links open without a password. The link itself is the key, so share it only with the person it's for."}
      </p>
      {olderLinks > 0 && !state.saved && (
        <p className="text-xs text-muted">
          {olderLinks === 1 ? "One link you made earlier still asks for its own password" : `${olderLinks} links you made earlier still ask for their own passwords`}{" "}
          until you set one here (or turn it off).
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="share-password">{isOn ? "New password" : "Password"}</label>
          <input className="field" id="share-password" name="password" type="password" minLength={6} autoComplete="new-password" />
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {isOn ? "Change password" : "Set password"}
        </button>
        {isOn && (
          <button className="btn" type="submit" name="clear" value="1" formNoValidate disabled={pending}>
            Turn off
          </button>
        )}
      </div>
      <span role="status" className="text-sm">
        {state.saved === "set" && !pending ? <span className="text-accent">Saved. People already in keep their access.</span> : null}
        {state.saved === "cleared" && !pending ? <span className="text-accent">Turned off.</span> : null}
      </span>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
