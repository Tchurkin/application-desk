"use client";
import { useActionState, useState } from "react";
import { deleteMyAccount } from "../../actions";

/** Delete everything: the button stays off until "delete" is typed. */
export function DeleteForm() {
  const [typed, setTyped] = useState("");
  const [state, action, pending] = useActionState(deleteMyAccount, {});
  const ready = typed.trim().toLowerCase() === "delete";
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="field max-w-48"
          name="confirm"
          placeholder='Type "delete"'
          aria-label='Type "delete" to confirm'
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button className="btn btn-danger" type="submit" disabled={!ready || pending}>
          {pending ? "Deleting…" : "Delete everything"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
