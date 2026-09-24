import { describe, expect, it } from "vitest";
import type { CatalogEntry } from "./match";
import { renderStrategy, type StrategyInfo } from "./render";

const base = {
  round: "EA",
  deadline: "2030-11-01",
  scorecard_id: null,
  chance_percent: null,
  chance_source: null,
  chance_note: "",
  fit_rank: null,
  campus_life: null,
  reputation: null,
  cost_sticker: null,
  cost_net: null,
  country: "US",
  intl_course: "",
  intl_criterion: "",
  intl_cost: "",
  intl_status: "",
  research: "",
} satisfies Omit<StrategyInfo["colleges"][number], "id" | "name">;

const purdue: CatalogEntry = {
  id: 243780,
  name: "Purdue University-Main Campus",
  city: "West Lafayette",
  state: "IN",
  rate: 0.499,
  sat: 1364,
  act: 30,
  cost: 24600,
  net: 14600,
  public: true,
};
const aie = (id: number, city: string): CatalogEntry => ({ id, name: "Academy of Interactive Entertainment", city, state: "WA", rate: 0.4 });

const catalog = {
  match: (name: string) => (name.startsWith("Purdue") ? purdue : null),
  candidates: (name: string) => (name.startsWith("Academy") ? [aie(1, "Seattle"), aie(2, "Lafayette")] : []),
};

describe("renderStrategy", () => {
  it("shows the profile, each college's chance and the published baseline", () => {
    const out = renderStrategy(
      {
        student: { name: "Testy", about: "Builds robots.", gpa: "3.9 unweighted", test_scores: "SAT 1450", intended_major: "Mechanical engineering" },
        colleges: [
          { ...base, id: "p1", name: "Purdue University-Main Campus" },
          { ...base, id: "n1", name: "Northfield University", chance_percent: 72, chance_source: "ai", chance_note: "Strong fit.", fit_rank: 1 },
          { ...base, id: "a1", name: "Academy of Interactive Entertainment" },
        ],
      },
      catalog,
    );
    expect(out).toContain("Academic profile: GPA 3.9 unweighted; test scores SAT 1450; intended major Mechanical engineering.");
    expect(out).toContain("Purdue University-Main Campus [college_id: p1]");
    expect(out).toContain("the desk shows the published average rate, 49.9% (Target)");
    expect(out).toContain("admission rate 49.9%, average SAT 1364, average ACT 30, cost of attendance $24,600/yr (in-state), average net price $14,600/yr, public [scorecard_id: 243780]");
    expect(out).toContain("Chance: 72% (AI estimate, Likely). Reasoning: Strong fit.");
    expect(out).toContain("fit rank #1");
    expect(out).toContain("not in the College Scorecard catalog");
    expect(out).toContain("[scorecard_id: 1]; Academy of Interactive Entertainment (Lafayette, WA) [scorecard_id: 2]");
  });

  it("asks for the academic profile when it's empty, and describes colleges outside the US without odds", () => {
    const out = renderStrategy(
      {
        student: { name: "Testy", about: "", gpa: "", test_scores: "", intended_major: "" },
        colleges: [{ ...base, id: "k1", name: "Kingsbridge University", country: "United Kingdom", intl_course: "Engineering, 4 years" }],
      },
      catalog,
    );
    expect(out).toContain("not entered yet");
    expect(out).toContain("update_academics");
    expect(out).toContain("## Colleges in the US (0)");
    expect(out).toContain("Kingsbridge University [college_id: k1] United Kingdom; course: Engineering, 4 years; what decides admission: (not set)");
    expect(out).not.toMatch(/Kingsbridge[^\n]*%/);
  });
});
