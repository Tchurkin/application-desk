import { requireDesk } from "@/lib/supabase/server";
import { AcademicsForm } from "../academics-form";
import { SettingsHeader } from "../settings-header";

export default async function AcademicsSettingsPage() {
  const { supabase, userId } = await requireDesk();
  // "*" so the academic fields (migration 20260928) come back when the database has them.
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", userId).single();

  return (
    <>
      <SettingsHeader title="Academics">
        <p>
          Your grades, scores and intended major. Claude or ChatGPT uses them, through your connector, to estimate your admission
          odds on the Strategy page. Every field is optional; write them however you like.
        </p>
      </SettingsHeader>
      <section className="card px-4 py-4" aria-label="Academic profile">
        {profile && "gpa" in profile ? (
          <AcademicsForm gpa={profile.gpa ?? ""} testScores={profile.test_scores ?? ""} intendedMajor={profile.intended_major ?? ""} />
        ) : (
          <p className="text-sm text-muted">Run the latest database update to use this.</p>
        )}
      </section>
    </>
  );
}
