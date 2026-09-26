import { requireDesk } from "@/lib/supabase/server";
import { SettingsHeader } from "../settings-header";
import { CounselorManage } from "./manage";

export default async function CounselorSettingsPage() {
  const { desk } = await requireDesk();
  return (
    <>
      <SettingsHeader title="Counselor">
        <p>
          Make Claude your counselor on this computer, so everything you ask on your desk gets answered on its own, with no chat to
          open. It&apos;s one download for Windows or Mac, run once: it works in the background, starts whenever you sign in, and
          uses your Claude plan only when you ask something. It remembers what you&apos;ve told it from one question to the next.
        </p>
        <p>It uses your own Claude plan through Claude Code, which needs to be installed and signed in once (claude.com/claude-code).</p>
      </SettingsHeader>
      <CounselorManage deskId={desk.id} />
    </>
  );
}
