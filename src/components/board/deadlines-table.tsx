import Link from "next/link";
import { APP_SYSTEMS, labelOf, ROUNDS } from "@/lib/domain/colleges";
import { DueTag } from "./due-tag";
import type { DeadlineRow } from "./summary";

/**
 * Every application at a glance, soonest first, fully submitted ones last. A college's name
 * opens the work left on it (its first unfinished piece); "Details" opens its settings. Without
 * `collegeHref` (people a desk is shared with have no college pages) the Details column is left out.
 */
export function DeadlinesTable({
  rows,
  today,
  pieceHref,
  collegeHref,
}: {
  rows: DeadlineRow[];
  today: string;
  pieceHref: (id: string) => string;
  collegeHref?: (id: string) => string;
}) {
  return (
    <section aria-labelledby="deadlines-heading" className="mb-10">
      <h2 id="deadlines-heading" className="mb-3 font-serif text-xl">Deadlines</h2>
      <div className="card overflow-x-auto">
        <table aria-labelledby="deadlines-heading" className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th scope="col" className="px-3 py-2 font-medium">College</th>
              <th scope="col" className="px-3 py-2 font-medium">Round</th>
              <th scope="col" className="px-3 py-2 font-medium">System</th>
              <th scope="col" className="px-3 py-2 font-medium">Due</th>
              <th scope="col" className="px-3 py-2 font-medium">Letters</th>
              <th scope="col" className="px-3 py-2 font-medium">Writing</th>
              {collegeHref && <th scope="col" className="px-3 py-2"><span className="sr-only">Details</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const { college } = r;
              const href = r.openPieceId ? pieceHref(r.openPieceId) : collegeHref?.(college.id);
              return (
                <tr
                  key={college.id}
                  data-deadline-row={college.id}
                  className={`border-b border-line last:border-0 hover:bg-bg ${r.submitted ? "opacity-60" : ""}`}
                >
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {href ? (
                      <Link
                        href={href}
                        title={r.openPieceId ? `Open ${college.name} writing` : `Add ${college.name}'s pieces`}
                        className="hover:underline"
                      >
                        {college.name}
                      </Link>
                    ) : (
                      college.name
                    )}
                  </th>
                  <td className="px-3 py-2 whitespace-nowrap">{labelOf(ROUNDS, college.round)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{labelOf(APP_SYSTEMS, college.app_system)}</td>
                  <td className="px-3 py-2">
                    <DueTag date={college.deadline} today={today} submitted={r.submitted} />
                  </td>
                  <td className="px-3 py-2 text-muted">{college.needs_letters ? "Needed" : "None"}</td>
                  <td className="px-3 py-2">
                    {r.total === 0 ? (
                      <span className="text-muted">No pieces</span>
                    ) : (
                      <div className="flex min-w-36 flex-col gap-1">
                        <span className="whitespace-nowrap">
                          {r.done}/{r.total} submitted
                          <span className="text-muted"> · {r.words.toLocaleString("en-US")} words</span>
                        </span>
                        <span className="h-1 overflow-hidden rounded-full bg-bg" aria-hidden>
                          <span className="block h-full bg-accent" style={{ width: `${(r.done / r.total) * 100}%` }} />
                        </span>
                      </div>
                    )}
                  </td>
                  {collegeHref && (
                    <td className="px-3 py-2 text-right">
                      <Link href={collegeHref(college.id)} className="text-muted hover:text-ink">
                        Details<span className="sr-only"> for {college.name}</span>
                      </Link>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
