import { describe, expect, it } from "vitest";
import { buildBoard, checkCommonApp, COMMON_APP_MAX, daysUntil, type College, type PieceSummary } from "./colleges";
import { countChars, countWords, limitState } from "./count";

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
const piece = (id: string, college_id: string, status: PieceSummary["status"]): PieceSummary => ({
  id,
  college_id,
  title: id,
  status,
  word_count: 0,
});

describe("buildBoard", () => {
  it("orders by deadline, undated last, fully submitted sink", () => {
    const cs = [
      college("a", { deadline: "2026-11-01" }),
      college("b", { deadline: "2026-10-15" }),
      college("c"),
      college("d", { deadline: "2026-10-01" }),
    ];
    const ps = [piece("d1", "d", "submitted"), piece("d2", "d", "submitted"), piece("a1", "a", "drafting")];
    const order = buildBoard(cs, ps).map((r) => r.college.id);
    expect(order).toEqual(["b", "a", "c", "d"]);
  });

  it("does not count a college with no pieces as submitted", () => {
    const rows = buildBoard([college("x")], []);
    expect(rows[0].submitted).toBe(false);
  });

  it("matches pieces to colleges by id, never by name prefix", () => {
    const cs = [college("1", { name: "Virginia" }), college("2", { name: "Virginia Tech" })];
    const rows = buildBoard(cs, [piece("p", "2", "drafting")]);
    expect(rows.find((r) => r.college.name === "Virginia")!.total).toBe(0);
    expect(rows.find((r) => r.college.name === "Virginia Tech")!.total).toBe(1);
  });
});

describe("checkCommonApp", () => {
  it("warns past the cap and suggests the no-letter schools", () => {
    const cs = Array.from({ length: COMMON_APP_MAX + 1 }, (_, i) =>
      college(String(i), { needs_letters: i % 5 !== 0 }),
    );
    cs.push(college("uc", { app_system: "uc" }));
    const r = checkCommonApp(cs);
    expect(r.count).toBe(COMMON_APP_MAX + 1);
    expect(r.over).toBe(true);
    expect(r.movable.map((c) => c.id)).toEqual(["0", "5", "10", "15", "20"]);
  });

  it("is fine at exactly the cap", () => {
    const cs = Array.from({ length: COMMON_APP_MAX }, (_, i) => college(String(i)));
    expect(checkCommonApp(cs).over).toBe(false);
  });
});

describe("counts", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one two\nthree\t four")).toBe(4);
    expect(countWords("well-known don't")).toBe(2);
  });
  it("counts characters as people see them", () => {
    expect(countChars("héllo")).toBe(5);
    expect(countChars("🚀!")).toBe(2);
  });
  it("reports the limit", () => {
    expect(limitState("a b c", "words", 2)).toMatchObject({ used: 3, over: true, fraction: 1 });
    expect(limitState("abc", "chars", 10)).toMatchObject({ used: 3, over: false });
    expect(limitState("a b", "none", 5)).toMatchObject({ limit: null, fraction: null });
  });
  it("counts days until a deadline", () => {
    expect(daysUntil("2026-10-15", "2026-09-23")).toBe(22);
    expect(daysUntil("2026-09-22", "2026-09-23")).toBe(-1);
  });
});
