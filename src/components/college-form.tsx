import { APP_SYSTEMS, ROUNDS, type College } from "@/lib/domain/colleges";

/** Fields shared by "add a college" and "edit college". */
export function CollegeFields({ college }: { college?: Partial<College> & { research?: string } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className="label" htmlFor="name">College</label>
        <input className="field" id="name" name="name" required defaultValue={college?.name} placeholder="e.g. Northfield University" />
      </div>
      <div>
        <label className="label" htmlFor="app_system">Applied through</label>
        <select className="field" id="app_system" name="app_system" defaultValue={college?.app_system ?? "common_app"}>
          {APP_SYSTEMS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="round">Round</label>
        <select className="field" id="round" name="round" defaultValue={college?.round ?? "RD"}>
          {ROUNDS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="deadline">Application deadline</label>
        <input className="field" id="deadline" name="deadline" type="date" defaultValue={college?.deadline ?? ""} />
      </div>
      <div>
        <label className="label" htmlFor="materials_deadline">Materials deadline</label>
        <input className="field" id="materials_deadline" name="materials_deadline" type="date" defaultValue={college?.materials_deadline ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="needs_letters" defaultChecked={college?.needs_letters ?? true} />
        Needs recommendation letters
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ai_policy" value="no_drafting" defaultChecked={college?.ai_policy === "no_drafting"} />
        This college forbids AI help with drafting
      </label>
    </div>
  );
}
