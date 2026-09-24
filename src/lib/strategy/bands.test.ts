import { describe, expect, it } from "vitest";
import {
  balanceNote,
  bandOf,
  barWidth,
  buildStrategy,
  chanceOf,
  costOf,
  formatMoney,
  formatPercent,
  isInternational,
  type Baseline,
  type StrategyCollege,
} from "./bands";

const college = (id: string, over: Partial<StrategyCollege> = {}): StrategyCollege => ({ id, name: `College ${id}`, ...over });

describe("bandOf", () => {
  it("uses the standard cutoffs, both ends of Target inclusive", () => {
    expect(bandOf(0)).toBe("reach");
    expect(bandOf(19.9)).toBe("reach");
    expect(bandOf(20)).toBe("target");
    expect(bandOf(60)).toBe("target");
    expect(bandOf(60.1)).toBe("likely");
    expect(bandOf(100)).toBe("likely");
  });

  it("puts a missing chance in Unrated, never Reach", () => {
    expect(bandOf(null)).toBe("unrated");
    expect(bandOf(undefined)).toBe("unrated");
    expect(bandOf(NaN)).toBe("unrated");
  });
});

describe("chanceOf", () => {
  const avg: Baseline = { rate: 0.499 };

  it("prefers the college's own chance and keeps its source", () => {
    expect(chanceOf(college("a", { chance_percent: 35, chance_source: "ai" }), avg)).toEqual({ value: 35, source: "ai" });
    expect(chanceOf(college("a", { chance_percent: 35, chance_source: "student" }), avg)).toEqual({ value: 35, source: "student" });
    // A number with no recorded source was entered by a person.
    expect(chanceOf(college("a", { chance_percent: 35, chance_source: null }), avg)?.source).toBe("student");
  });

  it("reads a numeric column that arrives as a string", () => {
    expect(chanceOf(college("a", { chance_percent: "42.50", chance_source: "ai" }), null)).toEqual({ value: 42.5, source: "ai" });
  });

  it("falls back to the published rate, as a percent with one decimal", () => {
    expect(chanceOf(college("a"), avg)).toEqual({ value: 49.9, source: "average" });
    expect(chanceOf(college("a"), { rate: 0.1964 })).toEqual({ value: 19.6, source: "average" });
  });

  it("is null with neither", () => {
    expect(chanceOf(college("a"), null)).toBeNull();
    expect(chanceOf(college("a", { chance_percent: "" }), null)).toBeNull();
  });
});

describe("costOf", () => {
  const base: Baseline = { rate: 0.5, cost: 60000, net: 28000 };

  it("prefers the student's net, then their sticker price", () => {
    expect(costOf(college("a", { cost_net: 21000, cost_sticker: 70000 }), base)).toEqual({ amount: 21000, kind: "net", average: false });
    expect(costOf(college("a", { cost_sticker: 70000 }), base)).toEqual({ amount: 70000, kind: "sticker", average: false });
  });

  it("falls back to the catalog's averages, marked", () => {
    expect(costOf(college("a"), base)).toEqual({ amount: 28000, kind: "net", average: true });
    expect(costOf(college("a"), { rate: 0.5, cost: 60000 })).toEqual({ amount: 60000, kind: "sticker", average: true });
    expect(costOf(college("a"), null)).toBeNull();
  });
});

describe("isInternational", () => {
  it("treats blank, missing and the ways of writing the US as the US", () => {
    for (const us of [undefined, null, "", "  ", "US", "us", "USA", "U.S.", "U.S.A.", "United States", "united states of america"]) {
      expect(isInternational(us)).toBe(false);
    }
    expect(isInternational("United Kingdom")).toBe(true);
    expect(isInternational("Canada")).toBe(true);
  });
});

describe("buildStrategy", () => {
  const baselines: Record<string, Baseline> = { mit: { rate: 0.045 }, purdue: { rate: 0.499 }, arizona: { rate: 0.861 } };
  const baselineOf = (c: StrategyCollege) => baselines[c.id] ?? null;

  it("places each college by its chance, and colleges outside the US apart", () => {
    const s = buildStrategy(
      [
        college("mit"),
        college("purdue"),
        college("arizona"),
        college("northfield"),
        college("kings", { country: "United Kingdom", chance_percent: 90 }),
      ],
      baselineOf,
    );
    const ids = (band: string) => s.bands.find((b) => b.id === band)!.rows.map((r) => r.college.id);
    expect(s.bands.map((b) => b.id)).toEqual(["reach", "target", "likely", "unrated"]);
    expect(ids("reach")).toEqual(["mit"]);
    expect(ids("target")).toEqual(["purdue"]);
    expect(ids("likely")).toEqual(["arizona"]);
    expect(ids("unrated")).toEqual(["northfield"]);
    expect(s.international.map((c) => c.id)).toEqual(["kings"]);
  });

  it("moves a college when its own chance overrides the average", () => {
    const s = buildStrategy([college("purdue", { chance_percent: 12, chance_source: "student" })], baselineOf);
    expect(s.bands[0].rows[0].chance).toEqual({ value: 12, source: "student" });
  });

  it("sorts a band by fit rank, then by the higher chance, then by name", () => {
    const s = buildStrategy(
      [
        college("c", { name: "Zeta", chance_percent: 30 }),
        college("d", { name: "Alpha", chance_percent: 30 }),
        college("a", { name: "Gamma", chance_percent: 25, fit_rank: 2 }),
        college("b", { name: "Beta", chance_percent: 50 }),
        college("e", { name: "Delta", chance_percent: 40, fit_rank: 1 }),
      ],
      () => null,
    );
    expect(s.bands[1].rows.map((r) => r.college.name)).toEqual(["Delta", "Gamma", "Beta", "Alpha", "Zeta"]);
  });

  it("keeps empty bands so the page can say so", () => {
    const s = buildStrategy([], () => null);
    expect(s.bands.map((b) => b.rows.length)).toEqual([0, 0, 0, 0]);
  });
});

describe("formatting", () => {
  it("formats percents without turning 19.6 into a 20 that sits in Reach", () => {
    expect(formatPercent(35)).toBe("35%");
    expect(formatPercent(49.9)).toBe("49.9%");
    expect(formatPercent(19.6)).toBe("19.6%");
    expect(formatPercent(0.4)).toBe("<1%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("formats yearly costs compactly", () => {
    expect(formatMoney(14600)).toBe("$14.6k");
    expect(formatMoney(60000)).toBe("$60k");
    expect(formatMoney(850)).toBe("$850");
  });

  it("never draws a bar under 3%", () => {
    expect(barWidth(0)).toBe(3);
    expect(barWidth(1.5)).toBe(3);
    expect(barWidth(45)).toBe(45);
    expect(barWidth(100)).toBe(100);
  });
});

describe("balanceNote", () => {
  const withChances = (...cs: number[]) =>
    buildStrategy(cs.map((c, i) => college(String(i), { chance_percent: c })), () => null);

  it("flags a list with no Likely college, or all Reaches", () => {
    expect(balanceNote(withChances(5, 10))).toMatch(/Every rated college is a Reach/);
    expect(balanceNote(withChances(5, 40))).toMatch(/No Likely college/);
    expect(balanceNote(withChances(5, 40, 80))).toBeNull();
    expect(balanceNote(withChances())).toBeNull();
  });
});
