import Link from "next/link";
import { BandSections } from "@/components/strategy/band-sections";
import { OddsRequest } from "@/components/strategy/odds-request";
import { balanceNote } from "@/lib/strategy/bands";
import { hasAcademics } from "@/lib/profile/academics";
import { loadStrategy, type Academics } from "@/lib/strategy/load";
import { requireDesk } from "@/lib/supabase/server";

const UPDATE_NEEDED = "Run the latest database update to use this.";

function AcademicsCard({ academics }: { academics: Academics | null }) {
  const filled = academics && hasAcademics(academics);
  return (
    <section aria-labelledby="academics" className="card flex flex-col gap-2 px-4 py-4">
      <h2 id="academics" className="font-serif text-lg">Academic profile</h2>
      {!academics ? (
        <p className="text-sm text-muted">{UPDATE_NEEDED}</p>
      ) : filled ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">GPA</dt>
          <dd>{academics.gpa || "—"}</dd>
          <dt className="text-muted">Test scores</dt>
          <dd>{academics.test_scores || "—"}</dd>
          <dt className="text-muted">Intended major</dt>
          <dd>{academics.intended_major || "—"}</dd>
          {academics.class_rank && (
            <>
              <dt className="text-muted">Class rank</dt>
              <dd>{academics.class_rank}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted">
          Add your GPA, test scores and intended major, or paste your transcript on your Profile, so an estimate is about you,
          not the average applicant.
        </p>
      )}
      <p className="text-sm">
        <Link href="/desk/profile#academics" className="text-accent underline">
          {filled ? "Edit on your Profile" : "Add them on your Profile"}
        </Link>
      </p>
    </section>
  );
}

export default async function StrategyPage() {
  const { supabase, userId, desk } = await requireDesk();
  const data = await loadStrategy(supabase, desk.id, userId);
  const total = data.strategy.bands.reduce((n, b) => n + b.rows.length, 0) + data.strategy.international.length;
  const balance = balanceNote(data.strategy);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="mb-2 font-serif text-3xl">Strategy</h1>
      <p className="mb-6 max-w-[62ch] text-sm text-muted">
        Each college sits in a band by its chance of admission. That chance is an estimate from Claude or ChatGPT (your grades,
        scores and major against the college&apos;s admitted class) or one you set yourself; until there is one, it&apos;s the
        college&apos;s published average admission rate, which ignores your profile. Fit is your own ranking, 1 being the best
        match. Cost is per year: your price after aid when you know it, otherwise the sticker price, with &ldquo;avg&rdquo;
        marking the college&apos;s published average.
      </p>

      {!data.editable && (
        <p className="mb-6 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">
          {UPDATE_NEEDED} Until then colleges show their published average rate, and chance, fit and cost can&apos;t be saved.
        </p>
      )}

      <div className="mb-8 grid gap-4 md:grid-cols-2">
        <AcademicsCard academics={data.academics} />
        <section aria-labelledby="estimate" className="card flex flex-col gap-2 px-4 py-4">
          <h2 id="estimate" className="font-serif text-lg">Estimate your odds</h2>
          <p className="text-sm text-muted">
            Your connected assistant reads your profile and each college&apos;s admitted class, sets a chance with its
            reasoning, and the bands update here.
          </p>
          <OddsRequest
            deskId={desk.id}
            assistants={data.assistants}
            pending={data.pendingOdds}
            last={data.lastOdds}
            bridge={data.bridge}
          />
        </section>
      </div>

      {balance && (
        <p className="mb-6 rounded-md border border-warn bg-warn-soft px-3 py-2 text-sm">{balance}</p>
      )}

      {total === 0 ? (
        <p className="card px-4 py-6 text-muted">
          No colleges yet. <Link href="/desk" className="text-accent underline">Add them on the Board</Link>, and they appear
          here in bands.
        </p>
      ) : (
        <BandSections strategy={data.strategy} editable={data.editable} />
      )}
    </main>
  );
}
