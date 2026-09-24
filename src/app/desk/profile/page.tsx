import Link from "next/link";
import { InterviewPanel } from "@/components/profile/interview-panel";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { bridgeMissing } from "@/lib/bridge/requests";
import { SECTION_COLS, type SectionRow } from "@/lib/profile/sections";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { supabase, desk } = await requireDesk();
  const { data, error } = await supabase.from("profile_sections").select(SECTION_COLS).eq("desk_id", desk.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Profile</h1>
      <p className="mb-6 max-w-[66ch] text-sm text-muted">
        What Claude knows about you: your background, activities, stories, values and goals. Write sections yourself, or let
        Claude interview you and write them as you talk. Claude reads your profile before helping with any essay, so the more
        specific it is, the more your essays sound like you. Your grades and scores are in{" "}
        <Link href="/desk/settings#academics" className="underline underline-offset-2">
          Settings
        </Link>
        .
      </p>
      {error ? (
        <p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">
          {bridgeMissing(error) ? "Run the latest database update to use your profile." : `Couldn't load your profile (${error.message}).`}
        </p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
          <ProfileEditor deskId={desk.id} initial={(data ?? []) as SectionRow[]} />
          <div className="lg:sticky lg:top-4">
            <InterviewPanel deskId={desk.id} />
          </div>
        </div>
      )}
    </main>
  );
}
