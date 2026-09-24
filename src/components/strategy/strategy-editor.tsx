"use client";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { updateStrategy } from "@/app/desk/strategy/actions";
import { formatPercent } from "@/lib/strategy/bands";
import type { StrategyCollegeView } from "@/lib/strategy/load";

/*
 * The student's own figures for one college, opened from its row on the Strategy page. Odds
 * colleges get chance, fit, campus life, reputation and cost; colleges outside the US get what
 * decides admission instead. Changing the country moves a college between the two.
 */

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

const value = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function StrategyEditor({
  college,
  kind,
  onDone,
}: {
  college: StrategyCollegeView;
  kind: "odds" | "intl";
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = (k: string) => `${college.id}-${k}`;
  const rate = college.baseline ? formatPercent(Math.round(college.baseline.rate * 1000) / 10) : null;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const r = await updateStrategy(college.id, form);
      if (r.error) setError(r.error);
      else onDone();
    });
  }

  return (
    <form aria-label={`Edit ${college.name}`} onSubmit={submit} className="flex flex-col gap-3 py-2 whitespace-normal">
      {kind === "odds" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id={id("chance")}
              label="Chance of admission (%)"
              hint={rate ? `Leave blank to use the published average rate, ${rate}.` : "Leave blank to leave it unrated."}
            >
              <input
                className="field"
                id={id("chance")}
                name="chance_percent"
                type="number"
                min={0}
                max={100}
                step="any"
                defaultValue={value(college.chance_percent)}
                placeholder={rate ?? ""}
                aria-describedby={`${id("chance")}-hint`}
              />
            </Field>
            <Field id={id("fit")} label="Fit rank (1 = best)">
              <input className="field" id={id("fit")} name="fit_rank" type="number" min={1} step={1} defaultValue={value(college.fit_rank)} />
            </Field>
            <Field id={id("country")} label="Country" hint="Outside the US? Enter its country and it moves to its own section.">
              <input
                className="field"
                id={id("country")}
                name="country"
                defaultValue={college.country ?? "US"}
                maxLength={60}
                aria-describedby={`${id("country")}-hint`}
              />
            </Field>
            <Field id={id("campus")} label="Campus life (0-10)">
              <input className="field" id={id("campus")} name="campus_life" type="number" min={0} max={10} step={1} defaultValue={value(college.campus_life)} />
            </Field>
            <Field id={id("reputation")} label="Reputation (0-10)">
              <input className="field" id={id("reputation")} name="reputation" type="number" min={0} max={10} step={1} defaultValue={value(college.reputation)} />
            </Field>
            <div />
            <Field id={id("net")} label="Net price per year after aid ($)">
              <input className="field" id={id("net")} name="cost_net" type="number" min={0} step={1} defaultValue={value(college.cost_net)} />
            </Field>
            <Field id={id("sticker")} label="Sticker price per year ($)">
              <input className="field" id={id("sticker")} name="cost_sticker" type="number" min={0} step={1} defaultValue={value(college.cost_sticker)} />
            </Field>
            {college.candidates.length > 1 && (
              <Field id={id("campus-pick")} label="Which college is it?" hint="Several colleges go by this name; pick yours for its published rate.">
                <select
                  className="field"
                  id={id("campus-pick")}
                  name="scorecard_id"
                  defaultValue={value(college.scorecard_id ?? college.baseline?.id)}
                  aria-describedby={`${id("campus-pick")}-hint`}
                >
                  <option value="">Not sure</option>
                  {college.candidates.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <Field id={id("note")} label="Reasoning">
            <textarea
              className="field"
              id={id("note")}
              name="chance_note"
              rows={2}
              maxLength={2000}
              defaultValue={college.chance_note ?? ""}
              placeholder="Why this chance: yours, or the AI's reasoning."
            />
          </Field>
        </>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={id("course")} label="Course">
            <input className="field" id={id("course")} name="intl_course" defaultValue={college.intl_course ?? ""} maxLength={500} placeholder="e.g. Engineering, 4 years" />
          </Field>
          <Field id={id("criterion")} label="What decides it">
            <input className="field" id={id("criterion")} name="intl_criterion" defaultValue={college.intl_criterion ?? ""} maxLength={500} placeholder="e.g. required exam grades, an admissions test" />
          </Field>
          <Field id={id("intl-cost")} label="Cost a year">
            <input className="field" id={id("intl-cost")} name="intl_cost" defaultValue={college.intl_cost ?? ""} maxLength={500} placeholder="e.g. ~£28,000" />
          </Field>
          <Field id={id("status")} label="Where it stands">
            <input className="field" id={id("status")} name="intl_status" defaultValue={college.intl_status ?? ""} maxLength={500} placeholder="e.g. ⏳ waiting for predicted grades" />
          </Field>
          <Field id={id("fit")} label="Fit rank (1 = best)">
            <input className="field" id={id("fit")} name="fit_rank" type="number" min={1} step={1} defaultValue={value(college.fit_rank)} />
          </Field>
          <Field id={id("country")} label="Country" hint='Set it to "US" to place it in the odds bands.'>
            <input
              className="field"
              id={id("country")}
              name="country"
              defaultValue={college.country ?? ""}
              maxLength={60}
              aria-describedby={`${id("country")}-hint`}
            />
          </Field>
        </div>
      )}
      {error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button className="btn" type="button" onClick={onDone} disabled={pending}>Cancel</button>
      </div>
    </form>
  );
}
