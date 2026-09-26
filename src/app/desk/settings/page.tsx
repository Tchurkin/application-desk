import Link from "next/link";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { requireDesk } from "@/lib/supabase/server";
import { updateProfile } from "../actions";
import { SettingsHeader } from "./settings-header";

export default async function ProfileSettingsPage() {
  const { supabase, userId, desk } = await requireDesk();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();

  return (
    <>
      <SettingsHeader title="General">
        <p>
          Your desk&apos;s name and how Claude knows you. Your academics and everything else about you are on your{" "}
          <Link href="/desk/profile" className="underline underline-offset-2">
            Profile
          </Link>
          .
        </p>
      </SettingsHeader>
      <form action={updateProfile} className="card flex flex-col gap-4 px-4 py-4">
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
          <FormattedTextarea
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
    </>
  );
}
