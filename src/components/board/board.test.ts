import { describe, expect, it } from "vitest";
import type { College, PieceSummary } from "@/lib/domain/colleges";
import type { CatalogEntry } from "@/lib/strategy/catalog";
import { chanceOf, formatPercent, levelOf } from "./chance";
import { daysLabel, shortDate, urgencyOf } from "./due";
import { formatUSD, isAbroad, moneyRow, sortByCost } from "./money";
import { boardStats, firstUnfinished } from "./summary";

const TODAY = "2030-09-01";

function college(id: string, over: Partial<College> = {}): College {
  return {
    id,
    name: `College ${id}`,
    app_system: "common_app",
    round: "RD",
    deadline: null,
    materials_deadline: null,
    ai_policy: "allowed",
    needs_letters: true,
    ...over,
  };
}
type P = PieceSummary & { due?: string | null };
const piece = (id: string, college_id: string | null, status: P["status"], over: Partial<P> = {}): P => ({
  id,
  college_id,
  title: id,
  status,
  word_count: 0,
  ...over,
});
const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 1,
  name: "Catalog U",
  city: "Somewhere",
  state: "MA",
  rate: 0.3,
  ...over,
});

describe("urgency", () => {
  it("is red within three weeks, amber within two months", () => {
    expect(urgencyOf(null)).toBe("none");
    expect(urgencyOf(-1)).toBe("passed");
    expect(urgencyOf(0)).toBe("now");
    expect(urgencyOf(21)).toBe("now");
    expect(urgencyOf(22)).toBe("soon");
    expect(urgencyOf(60)).toBe("soon");
    expect(urgencyOf(61)).toBe("later");
  });

  it("labels days and dates", () => {
    expect(daysLabel(-3)).toBe("passed");
    expect(daysLabel(0)).toBe("today");
    expect(daysLabel(1)).toBe("1 day");
    expect(daysLabel(12)).toBe("12 days");
    expect(shortDate("2030-11-01", TODAY)).toBe("Nov 1");
    expect(shortDate("2031-01-05", TODAY)).toBe("Jan 5, 2031");
  });
});

describe("firstUnfinished", () => {
  it("skips final and submitted pieces, else falls back to the first", () => {
    expect(firstUnfinished([piece("a", "c", "final"), piece("b", "c", "submitted"), piece("c", "c", "drafting")])?.id).toBe("c");
    expect(firstUnfinished([piece("a", "c", "final"), piece("b", "c", "submitted")])?.id).toBe("a");
    expect(firstUnfinished([])).toBeNull();
  });
});

describe("boardStats", () => {
  it("counts colleges, pieces, submissions and words", () => {
    const cs = [college("a", { deadline: "2030-09-11" }), college("b", { deadline: "2030-10-11" })];
    const ps = [
      piece("a1", "a", "submitted", { word_count: 100 }),
      piece("b1", "b", "final", { word_count: 40 }),
      piece("b2", "b", "drafting", { word_count: 5 }),
      piece("s", null, "not_started"),
    ];
    const s = boardStats(cs, ps, TODAY);
    expect(s).toMatchObject({ colleges: 2, collegesSubmitted: 1, pieces: 4, finished: 2, review: 0, words: 145 });
  });

  it("counts a college as submitted by its own mark when the database has one", () => {
    const cs = [
      college("sent", { name: "Sent", deadline: "2030-09-05", submitted_at: "2030-08-30T12:00:00Z" }),
      college("open", { name: "Open", deadline: "2030-10-01", submitted_at: null }),
    ];
    const ps = [piece("s1", "sent", "final", { due: "2030-09-02" }), piece("o1", "open", "submitted")];
    const s = boardStats(cs, ps, TODAY);
    expect(s.collegesSubmitted).toBe(1);
    // A submitted college's pieces are no longer owed, whatever their own dates.
    expect(s.next).toEqual({ date: "2030-10-01", days: 30, label: "Open" });
  });

  it("finds the next deadline among work still owed, skipping passed and fully submitted colleges", () => {
    const cs = [
      college("past", { deadline: "2030-08-01" }),
      college("sent", { name: "Sent", deadline: "2030-09-05" }),
      college("open", { name: "Open", deadline: "2030-10-01" }),
    ];
    const ps = [piece("x", "sent", "submitted")];
    expect(boardStats(cs, ps, TODAY).next).toEqual({ date: "2030-10-01", days: 30, label: "Open" });
  });

  it("counts a college with no pieces as owed, and a piece due before its college", () => {
    const cs = [college("a", { name: "Alpha", deadline: "2030-11-01" })];
    const early = piece("Interview form", "a", "drafting", { due: "2030-09-03" });
    expect(boardStats(cs, [], TODAY).next?.label).toBe("Alpha");
    expect(boardStats(cs, [early], TODAY).next).toEqual({ date: "2030-09-03", days: 2, label: "Interview form · Alpha" });
    // A submitted piece's own date is no longer owed; the college still is while it has open work.
    const essay = piece("Essay", "a", "drafting");
    expect(boardStats(cs, [{ ...early, status: "submitted" }, essay], TODAY).next?.label).toBe("Alpha");
    // And once everything is sent, nothing is owed.
    expect(boardStats(cs, [{ ...early, status: "submitted" }], TODAY).next).toBeNull();
  });

  it("has no next deadline when nothing is upcoming", () => {
    expect(boardStats([college("a")], [], TODAY).next).toBeNull();
  });
});

describe("money", () => {
  const c = { id: "1", name: "Catalog U", country: "US", cost_sticker: null, cost_net: null, intl_cost: "" };

  it("falls back to the catalog average, marked avg", () => {
    const row = moneyRow(c, entry({ cost: 82_700, net: 20_100 }));
    expect(row.sticker).toEqual({ amount: 82_700, avg: true });
    expect(row.net).toEqual({ amount: 20_100, avg: true });
  });

  it("prefers the college's own figures, one at a time", () => {
    const row = moneyRow({ ...c, cost_net: 15_000 }, entry({ cost: 82_700, net: 20_100 }));
    expect(row.net).toEqual({ amount: 15_000, avg: false });
    expect(row.sticker).toEqual({ amount: 82_700, avg: true });
  });

  it("works on a database without the cost columns", () => {
    const row = moneyRow({ id: "1", name: "Old" }, entry({ cost: 30_000 }));
    expect(row.sticker).toEqual({ amount: 30_000, avg: true });
    expect(row.net).toBeNull();
  });

  it("explains missing figures and public in-state averages", () => {
    expect(moneyRow(c, null).note).toBe("Not in the college catalog.");
    expect(moneyRow(c, entry()).note).toBe("No cost on file.");
    expect(moneyRow(c, entry({ cost: 28_000, public: true })).note).toMatch(/in-state/);
  });

  it("never uses the US catalog for a college abroad", () => {
    expect(isAbroad({ country: "United Kingdom" })).toBe(true);
    expect(isAbroad({ country: "USA" })).toBe(false);
    expect(isAbroad({ country: "" })).toBe(false);
    expect(isAbroad({})).toBe(false);
    const row = moneyRow({ ...c, country: "United Kingdom", intl_cost: "£9,250 tuition" }, entry({ cost: 1 }));
    expect(row.sticker).toBeNull();
    expect(row.note).toBe("£9,250 tuition");
  });

  it("sorts cheapest net first, unknown last", () => {
    const rows = [
      { id: "a", name: "A", sticker: null, net: null, note: "" },
      { id: "b", name: "B", sticker: { amount: 50_000, avg: true }, net: null, note: "" },
      { id: "c", name: "C", sticker: { amount: 80_000, avg: true }, net: { amount: 20_000, avg: true }, note: "" },
    ];
    expect(sortByCost(rows).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("formats dollars", () => {
    expect(formatUSD(82_700)).toBe("$82,700");
  });
});

describe("chance", () => {
  it("uses the standard cutoffs, with Unrated for no number", () => {
    expect(levelOf(null)).toBe("unrated");
    expect(levelOf(19.9)).toBe("reach");
    expect(levelOf(20)).toBe("target");
    expect(levelOf(60)).toBe("target");
    expect(levelOf(60.1)).toBe("likely");
  });

  it("prefers the AI or student estimate, then the average rate", () => {
    const us = { country: "US" };
    expect(chanceOf({ ...us, chance_percent: 35, chance_source: "ai" }, entry({ rate: 0.05 }))).toEqual({
      percent: 35,
      source: "ai",
      level: "target",
    });
    expect(chanceOf({ ...us, chance_percent: 70, chance_source: "student" }, null).source).toBe("student");
    expect(chanceOf({ ...us, chance_percent: null }, entry({ rate: 0.045 }))).toEqual({ percent: 4.5, source: "avg", level: "reach" });
    expect(chanceOf({ ...us, chance_percent: null }, null)).toEqual({ percent: null, source: null, level: "unrated" });
    // Older databases have no chance columns at all.
    expect(chanceOf({}, entry({ rate: 0.8 })).level).toBe("likely");
  });

  it("reads numeric strings from Postgres", () => {
    expect(chanceOf({ chance_percent: "42.50" as unknown as number, chance_source: "ai" }, null).percent).toBe(42.5);
  });

  it("formats percents", () => {
    expect(formatPercent(4.5)).toBe("4.5%");
    expect(formatPercent(35.4)).toBe("35%");
    expect(formatPercent(0.4)).toBe("<1%");
    expect(formatPercent(0)).toBe("0%");
  });
});
