import { describe, expect, it } from "vitest";
import { parseStrategyForm } from "./form";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("parseStrategyForm", () => {
  it("makes a changed chance the student's own", () => {
    expect(parseStrategyForm(form({ chance_percent: "45" }), { chance_percent: null })).toEqual({
      patch: { chance_percent: 45, chance_source: "student" },
    });
    expect(parseStrategyForm(form({ chance_percent: "12.5%" }), { chance_percent: 40 })).toEqual({
      patch: { chance_percent: 12.5, chance_source: "student" },
    });
  });

  it("leaves an unchanged chance (and so the AI's source) alone", () => {
    expect(parseStrategyForm(form({ chance_percent: "35" }), { chance_percent: 35 })).toEqual({ patch: {} });
    expect(parseStrategyForm(form({ chance_percent: "35" }), { chance_percent: "35.00" })).toEqual({ patch: {} });
  });

  it("clearing the chance goes back to the average rate and drops the old reasoning", () => {
    expect(parseStrategyForm(form({ chance_percent: "", chance_note: "AI said so" }), { chance_percent: 35 })).toEqual({
      patch: { chance_percent: null, chance_source: null, chance_note: "" },
    });
    // Nothing set before: nothing to clear, and a note still saves.
    expect(parseStrategyForm(form({ chance_percent: "", chance_note: " mine " }), { chance_percent: null })).toEqual({
      patch: { chance_note: "mine" },
    });
  });

  it("reads fit, campus life, reputation and costs, blank as unset", () => {
    const r = parseStrategyForm(
      form({ fit_rank: "2", campus_life: "7", reputation: "", cost_sticker: "60,000", cost_net: "$21000" }),
      { chance_percent: null },
    );
    expect(r).toEqual({ patch: { fit_rank: 2, campus_life: 7, reputation: null, cost_sticker: 60000, cost_net: 21000 } });
  });

  it("rejects numbers out of range", () => {
    expect(parseStrategyForm(form({ chance_percent: "140" }), { chance_percent: null })).toEqual({
      error: "Chance must be between 0 and 100.",
    });
    expect(parseStrategyForm(form({ campus_life: "11" }), { chance_percent: null })).toEqual({
      error: "Campus life must be a whole number between 0 and 10.",
    });
    expect(parseStrategyForm(form({ fit_rank: "0" }), { chance_percent: null })).toEqual({
      error: "Fit rank must be a whole number 1 or more.",
    });
    expect(parseStrategyForm(form({ cost_net: "lots" }), { chance_percent: null })).toHaveProperty("error");
  });

  it("stores the US as US however it's written, and other countries as typed", () => {
    expect(parseStrategyForm(form({ country: "" }), { chance_percent: null })).toEqual({ patch: { country: "US" } });
    expect(parseStrategyForm(form({ country: "united states" }), { chance_percent: null })).toEqual({ patch: { country: "US" } });
    expect(parseStrategyForm(form({ country: " United Kingdom " }), { chance_percent: null })).toEqual({
      patch: { country: "United Kingdom" },
    });
  });

  it("keeps the international fields as text, and only fields that were in the form", () => {
    const r = parseStrategyForm(form({ intl_course: " Engineering, 4 years ", intl_status: "⏳ awaiting" }), { chance_percent: 10 });
    expect(r).toEqual({ patch: { intl_course: "Engineering, 4 years", intl_status: "⏳ awaiting" } });
  });

  it("reads the chosen campus, or none", () => {
    expect(parseStrategyForm(form({ scorecard_id: "243780" }), { chance_percent: null })).toEqual({ patch: { scorecard_id: 243780 } });
    expect(parseStrategyForm(form({ scorecard_id: "" }), { chance_percent: null })).toEqual({ patch: { scorecard_id: null } });
  });
});
