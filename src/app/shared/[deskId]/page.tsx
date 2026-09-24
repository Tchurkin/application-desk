import { redirect } from "next/navigation";
import { Board, PieceChips } from "@/components/board";
import { loadDesk, todayISO } from "@/lib/data/queries";
import { requireDeskAccess } from "@/lib/supabase/server";

export default async function SharedBoard(props: PageProps<"/shared/[deskId]">) {
  const { deskId } = await props.params;
  const { supabase, role } = await requireDeskAccess(deskId);
  if (role === "owner") redirect("/desk");
  const { colleges, pieces } = await loadDesk(supabase, deskId);
  const shared = pieces.filter((p) => !p.college_id);
  const href = (id: string) => `/shared/${deskId}/piece/${id}`;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl">Board</h1>
      <Board colleges={colleges} pieces={pieces} today={todayISO()} pieceHref={href} />
      {shared.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 font-serif text-xl">Shared pieces</h2>
          <PieceChips pieces={shared} pieceHref={href} />
        </section>
      )}
    </main>
  );
}
