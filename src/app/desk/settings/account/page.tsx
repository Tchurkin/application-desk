import { SettingsHeader } from "../settings-header";
import { DeleteForm } from "./delete-form";

export default function AccountSettingsPage() {
  return (
    <>
      <SettingsHeader title="Account" />
      <section className="rounded-lg border border-danger px-4 py-4" aria-labelledby="delete-h">
        <h3 id="delete-h" className="mb-2 font-medium text-danger">Delete my data</h3>
        <p className="mb-3 text-sm">
          Permanently deletes your account, your desk, every college and piece, and all version history. This can&apos;t be undone.
        </p>
        <DeleteForm />
      </section>
    </>
  );
}
