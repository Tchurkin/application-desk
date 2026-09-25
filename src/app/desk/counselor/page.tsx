import { CounselorView } from "@/components/counselor/counselor-view";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Counselor" };

/** The conversation fills the window under the desk's header; only the messages scroll. */
export default async function CounselorPage() {
  const { desk } = await requireDesk();
  return (
    <main data-fill-page className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col px-4 pt-3 pb-3">
      <CounselorView deskId={desk.id} />
    </main>
  );
}
