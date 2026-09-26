import { redirect } from "next/navigation";
import { BandSections } from "@/components/strategy/band-sections";
import { balanceNote } from "@/lib/strategy/bands";
import { loadStrategy } from "@/lib/strategy/load";
import { requireDeskAccess } from "@/lib/supabase/server";

export const metadata = { title: "Strategy" };

/**
 * A shared desk's Strategy page, to read: the colleges in bands by chance, with fit, campus life,
 * reputation and cost, and the reasoning behind each chance. The student's academics and their
 * requests to their assistant stay theirs.
 */
export default async function SharedStrategyPage(props: PageProps<"/shared/[deskId]/strategy">) {
  const { deskId } = await props.params;
  const { supabase, role } = await requireDeskAccess(deskId);
  if (role === "owner") redirect("/desk/strategy");
  const data = await loadStrategy(supabase, deskId, null);
  const total = data.strategy.bands.reduce((n, b) => n + b.rows.length, 0) + data.strategy.international.length;
  const balance = balanceNote(data.strategy);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Strategy</h1>
      <p className="mb-6 max-w-[62ch] text-sm text-muted">
        Each college sits in a band by its chance of admission. That chance is an estimate from the student&apos;s AI assistant
        (their grades, scores and major against the college&apos;s admitted class) or one they set themselves; until there is
        one, it&apos;s the college&apos;s published average admission rate. Fit is their own ranking, 1 being the best match.
        Cost is per year: the price after aid when they know it, otherwise the sticker price, with &ldquo;avg&rdquo; marking
        the college&apos;s published average.
      </p>

      {balance && <p className="mb-6 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">{balance}</p>}

      {total === 0 ? (
        <p className="card px-4 py-6 text-muted">No colleges on this desk yet.</p>
      ) : (
        <BandSections strategy={data.strategy} editable={false} guest />
      )}
    </main>
  );
}
