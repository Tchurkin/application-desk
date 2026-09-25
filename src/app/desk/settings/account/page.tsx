import { deleteMyAccount } from "../../actions";
import { SettingsHeader } from "../settings-header";

export default function AccountSettingsPage() {
  return (
    <>
      <SettingsHeader title="Account" />
      <section className="rounded-lg border border-danger px-4 py-4" aria-labelledby="delete-h">
        <h3 id="delete-h" className="mb-2 font-medium text-danger">Delete my data</h3>
        <p className="mb-3 text-sm">
          Permanently deletes your account, your desk, every college and piece, and all version history. This can&apos;t be undone.
        </p>
        <form action={deleteMyAccount} className="flex flex-wrap items-center gap-2">
          <input className="field max-w-48" name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autoComplete="off" />
          <button className="btn btn-danger" type="submit">Delete everything</button>
        </form>
      </section>
    </>
  );
}
