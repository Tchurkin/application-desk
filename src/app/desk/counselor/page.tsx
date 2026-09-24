import { CounselorView } from "@/components/counselor/counselor-view";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Counselor" };

export default async function CounselorPage() {
  const { desk } = await requireDesk();
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Counselor</h1>
      <p className="mb-6 max-w-[66ch] text-sm text-muted">
        Your counselor is Claude, working on your desk on your own Claude plan. Talk to it here, or ask from anywhere on your desk
        (Ask beside an essay, odds on Strategy, the interview on Profile); the answers arrive as they&apos;re written.
      </p>
      <CounselorView deskId={desk.id} />
    </main>
  );
}
