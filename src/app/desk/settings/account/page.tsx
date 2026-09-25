import { SettingsHeader } from "../settings-header";
import { DeleteForm } from "./delete-form";

export default function AccountSettingsPage() {
  return (
    <>
      <SettingsHeader title="Account" />
      <section className="card mb-6 px-4 py-4" aria-labelledby="download-h">
        <h3 id="download-h" className="mb-1 font-medium">Download all my writing</h3>
        <p className="mb-3 text-sm text-muted">
          Every piece as a Word file (Google Docs opens them too), in a folder for each college, plus everything on your desk in one
          file. Keep a copy anywhere you like.
        </p>
        {/* The route answers with an attachment, so the browser saves it and stays here. */}
        <a href="/desk/export" className="btn btn-primary">
          Download all my writing
        </a>
      </section>
      <section className="rounded-lg border border-danger px-4 py-4" aria-labelledby="delete-h">
        <h3 id="delete-h" className="mb-2 font-medium text-danger">Delete my data</h3>
        <p className="mb-3 text-sm">
          Permanently deletes your account, your desk, every college and piece, and all version history. This can&apos;t be undone,
          and nothing goes to the Trash: download your writing first if you want to keep it.
        </p>
        <DeleteForm />
      </section>
    </>
  );
}
