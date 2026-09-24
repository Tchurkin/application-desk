import { ProgressBoard } from "@/components/progress/progress-board";
import { todayISO } from "@/lib/data/queries";
import { loadProgress } from "@/lib/progress/load";
import { requireDesk } from "@/lib/supabase/server";

export default async function ProgressPage(props: PageProps<"/desk/progress">) {
  const [{ supabase, desk }, { view }] = await Promise.all([requireDesk(), props.searchParams]);
  const { colleges, pieces, behind } = await loadProgress(supabase, desk.id);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="font-serif text-3xl">Progress</h1>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-muted">
        Every piece, and how far along it is. Drag a piece to change its stage, or focus it and use the arrow keys.
        Click it (or press Enter) to open it, and use the arrow beside a college to see each of its pieces.
      </p>
      <ProgressBoard
        deskId={desk.id}
        initial={{ colleges, pieces }}
        serverToday={todayISO()}
        base="/desk"
        canWrite
        collegeLinks
        view={view === "columns" ? "columns" : "lanes"}
        behind={behind}
      />
    </main>
  );
}
