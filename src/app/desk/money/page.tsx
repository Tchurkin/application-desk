import Link from "next/link";
import { moneyRow, sortByCost } from "@/components/board/money";
import { MoneyTable } from "@/components/board/money-table";
import { loadDesk } from "@/lib/data/queries";
import { matchCollege } from "@/lib/strategy/catalog";
import { requireDesk } from "@/lib/supabase/server";

export const metadata = { title: "Money" };

export default async function MoneyPage() {
  const { supabase, desk } = await requireDesk();
  const { colleges } = await loadDesk(supabase, desk.id);
  const rows = sortByCost(colleges.map((c) => moneyRow(c, matchCollege(c.name, c.scorecard_id))));
  // loadDesk selects "*": the cost columns are missing until migration 20260928 has run.
  const costColumns = colleges.length === 0 || "cost_net" in colleges[0];

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <nav className="mb-2 text-sm text-muted">
        <Link href="/desk">Board</Link>
      </nav>
      <h1 className="mb-1 font-serif text-3xl">Money</h1>
      <p className="mb-5 max-w-[66ch] text-sm text-muted">
        A year at each college: the sticker price, and the net price after grants and aid. Each college&apos;s net price calculator
        gives your own figure; set it on the Strategy page, or ask Claude to find it.
      </p>
      {colleges.length === 0 ? (
        <p className="card px-4 py-6 text-muted">
          No colleges yet. <Link href="/desk/add/college" className="underline">Add one</Link> and its costs show here.
        </p>
      ) : (
        <MoneyTable rows={rows} needsUpdate={!costColumns} />
      )}
    </main>
  );
}
