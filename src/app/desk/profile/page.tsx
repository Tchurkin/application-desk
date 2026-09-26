import { AcademicsCard } from "@/components/profile/academics";
import { InterviewStart } from "@/components/profile/interview-start";
import { ProfileEditor } from "@/components/profile/profile-editor";
import { bridgeMissing, REQUEST_COLS, type DeskRequest } from "@/lib/bridge/requests";
import { academicsOf } from "@/lib/profile/academics";
import { FILE_COLS, type FileRow } from "@/lib/profile/files";
import { SECTION_COLS, type SectionRow } from "@/lib/profile/sections";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { supabase, userId, desk } = await requireDesk();
  const [{ data, error }, { data: profile }, transcripts, files] = await Promise.all([
    supabase.from("profile_sections").select(SECTION_COLS).eq("desk_id", desk.id),
    // "*" so the academic fields come back when the database has them.
    supabase.from("profiles").select("*").eq("id", userId).single(),
    // A transcript still being read (its answer also stays in the counselor chat).
    supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", desk.id)
      .eq("kind", "transcript")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1),
    // Missing on a database from before files (migration 20261015): notes only.
    supabase.from("profile_files").select(FILE_COLS).eq("desk_id", desk.id).order("created_at"),
  ]);
  const academics = academicsOf(profile);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Profile</h1>
      <p className="mb-6 max-w-[66ch] text-sm text-muted">
        What Claude knows about you: your academics, background, activities, stories, values and goals. Write notes yourself, let
        Claude interview you and write them as you talk, or upload files like a resume or a school&apos;s form to fill in. Claude
        reads your profile before helping with any essay, so the more specific it is, the more your essays sound like you.
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <AcademicsCard
            deskId={desk.id}
            values={academics?.academics ?? null}
            full={!!academics?.full}
            transcript={((transcripts.data ?? []) as unknown as DeskRequest[])[0] ?? null}
            transcriptReady={!!academics?.full && !transcripts.error}
          />
          {error ? (
            <p className="rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">
              {bridgeMissing(error) ? "Run the latest database update to use your profile." : `Couldn't load your profile (${error.message}).`}
            </p>
          ) : (
            <ProfileEditor deskId={desk.id} initial={(data ?? []) as SectionRow[]} files={files.error ? null : ((files.data ?? []) as FileRow[])} />
          )}
        </div>
        <div className="lg:sticky lg:top-4">
          <InterviewStart deskId={desk.id} />
        </div>
      </div>
    </main>
  );
}
