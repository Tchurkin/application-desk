"use client";
import { useActionState } from "react";
import { updateAcademics, type AcademicsState } from "./academics-actions";

/** Settings: the academic profile the connected AI uses to estimate admission odds. */
export function AcademicsForm({
  gpa,
  testScores,
  intendedMajor,
}: {
  gpa: string;
  testScores: string;
  intendedMajor: string;
}) {
  const [state, action, pending] = useActionState<AcademicsState, FormData>(updateAcademics, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="gpa">GPA</label>
          <input className="field" id="gpa" name="gpa" maxLength={40} defaultValue={gpa} placeholder="e.g. 3.85 unweighted" />
        </div>
        <div>
          <label className="label" htmlFor="intended_major">Intended major</label>
          <input
            className="field"
            id="intended_major"
            name="intended_major"
            maxLength={200}
            defaultValue={intendedMajor}
            placeholder="e.g. Mechanical engineering"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="test_scores">Test scores</label>
        <input
          className="field"
          id="test_scores"
          name="test_scores"
          maxLength={200}
          defaultValue={testScores}
          placeholder="e.g. SAT 1450 (750 math), or test-optional"
        />
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save academics"}
        </button>
        <span role="status" className="text-sm">
          {state.saved && !pending ? <span className="text-accent">Saved</span> : null}
        </span>
      </div>
      {state.error && <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
    </form>
  );
}
