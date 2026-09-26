"use client";
import { useActionState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { SHARE_ROLES, type ShareRole } from "@/lib/domain/share";
import { setDeskSharing, stopDeskSharing, type DeskSharingState } from "../../share-actions";

/**
 * Sharing by desk name and password: anyone who has both opens the desk from the home page, and
 * can do what's chosen here. On, the password can be left blank to keep it.
 */
export function DeskSharing({ name, suggested, on, role }: { name: string | null; suggested: string; on: boolean; role: ShareRole }) {
  const [state, action, pending] = useActionState<DeskSharingState, FormData>(setDeskSharing, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm">
        {on
          ? `On: anyone with your desk name and password can open your desk from the home page.`
          : "Off. Give your desk a name and a password, then tell them to the people you want in: they open your desk from the home page, no link needed."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="share-name">
            Desk name
          </label>
          <input
            className="field"
            id="share-name"
            name="name"
            required
            defaultValue={name ?? suggested}
            pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,39}"
            title="3 to 40 letters, numbers or dashes"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div>
          <label className="label" htmlFor="share-password">
            {on ? "New password" : "Password"}
          </label>
          <input
            className="field"
            id="share-password"
            name="password"
            type="password"
            minLength={8}
            required={!on}
            placeholder={on ? "Leave blank to keep it" : "At least 8 characters"}
            autoComplete="new-password"
          />
        </div>
      </div>
      <div className="max-w-xs">
        <label className="label" htmlFor="share-role">
          People with the password can
        </label>
        {/* Keyed, so after a save it shows the saved choice (a form resets its selects to how they first rendered). */}
        <select key={role} className="field" id="share-role" name="role" defaultValue={role}>
          {SHARE_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {on ? "Save" : "Turn on sharing"}
        </button>
        {on && (
          <ConfirmButton
            label="Turn off"
            confirmLabel="Turn off"
            question="Turn off sharing? Everyone who came in with the password loses access."
            onConfirm={stopDeskSharing}
          />
        )}
      </div>
      <span role="status" className="text-sm">
        {state.saved && !pending ? <span className="text-accent">Saved.</span> : null}
      </span>
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
