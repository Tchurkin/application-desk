import { ImportView } from "@/components/import/import-view";
import type { DeskCollege, DeskPiece } from "@/lib/import/plan";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Import essays" };

export default async function ImportPage() {
  const { supabase, desk } = await requireDesk();
  const [{ data: colleges }, { data: pieces }] = await Promise.all([
    supabase.from("colleges").select("id, name").eq("desk_id", desk.id).order("name"),
    supabase.from("pieces").select("id, title, college_id, word_count").eq("desk_id", desk.id).order("sort").order("created_at"),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Import your essays</h1>
      <p className="mb-6 max-w-[66ch] text-sm text-muted">
        Bring over what you&apos;ve written in Google Docs, whether it&apos;s a folder with a doc per essay or one doc with a tab for each.
        Each essay lands on the right college&apos;s piece when its name says which; you check the list before anything is imported. Add
        your colleges first (or have Claude set them up) and the essays go straight into their prompts.
      </p>
      <ImportView colleges={(colleges ?? []) as DeskCollege[]} pieces={(pieces ?? []) as DeskPiece[]} />
    </main>
  );
}
