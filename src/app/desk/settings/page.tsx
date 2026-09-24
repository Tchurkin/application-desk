import { requireDesk } from "@/lib/supabase/server";
import { deleteMyAccount, updateProfile } from "../actions";

export default async function SettingsPage() {
  const { supabase, userId, desk } = await requireDesk();
  const { data: profile } = await supabase.from("profiles").select("display_name, about").eq("id", userId).single();

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl">Settings</h1>

      <form action={updateProfile} className="card mb-10 flex flex-col gap-4 px-4 py-4">
        <div>
          <label className="label" htmlFor="title">Desk name</label>
          <input className="field" id="title" name="title" defaultValue={desk.title} />
        </div>
        <div>
          <label className="label" htmlFor="display_name">Your first name</label>
          <input className="field" id="display_name" name="display_name" defaultValue={profile?.display_name ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="about">About you</label>
          <textarea
            className="field"
            id="about"
            name="about"
            rows={6}
            defaultValue={profile?.about ?? ""}
            placeholder="Activities, interests, what you want to study. Only used as context if you turn on the counselor."
          />
        </div>
        <div><button className="btn btn-primary" type="submit">Save</button></div>
      </form>

      <section className="rounded-lg border border-danger px-4 py-4">
        <h2 className="mb-2 font-medium text-danger">Delete my data</h2>
        <p className="mb-3 text-sm">
          Permanently deletes your account, your desk, every college and piece, and all version history. This can&apos;t be
          undone.
        </p>
        <form action={deleteMyAccount} className="flex flex-wrap items-center gap-2">
          <input className="field max-w-48" name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autoComplete="off" />
          <button className="btn btn-danger" type="submit">Delete everything</button>
        </form>
      </section>
    </main>
  );
}
