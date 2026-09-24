import { describe, expect, it } from "vitest";
import { profileForPiece, renderProfile } from "./render";
import { mergeSection, moveSection, nextSort, removeSection, sortSections, type SectionRow } from "./sections";

const row = (id: string, sort: number, title = id, created = "2026-09-24T10:00:00Z"): SectionRow => ({
  id,
  desk_id: "d",
  title,
  body: `${title} body`,
  sort,
  updated_by: "",
  created_at: created,
  updated_at: created,
});

describe("profile sections", () => {
  it("keeps the student's order, oldest first on ties", () => {
    const list = sortSections([row("b", 2), row("a", 1), row("c", 2, "c", "2026-09-24T09:00:00Z")]);
    expect(list.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("merges live rows and removals", () => {
    let list = [row("a", 1), row("b", 2)];
    list = mergeSection(list, { ...row("b", 0), title: "moved" });
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(list[0].title).toBe("moved");
    expect(removeSection(list, "zzz")).toBe(list);
    expect(removeSection(list, "a").map((s) => s.id)).toEqual(["b"]);
  });

  it("adds at the end", () => {
    expect(nextSort([])).toBe(1);
    expect(nextSort([row("a", 3), row("b", 7)])).toBe(8);
  });

  it("moves by swapping with a neighbour, and not past either end", () => {
    const list = [row("a", 1), row("b", 2), row("c", 3)];
    expect(moveSection(list, 0, -1)).toBeNull();
    expect(moveSection(list, 2, 1)).toBeNull();
    const up = moveSection(list, 2, -1)!;
    const after = sortSections(list.map((s) => ({ ...s, sort: up.find((u) => u.id === s.id)?.sort ?? s.sort })));
    expect(after.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("pulls apart sections with the same sort when moving", () => {
    const list = sortSections([row("a", 1), row("b", 1, "b", "2026-09-24T11:00:00Z")]);
    const down = moveSection(list, 0, 1)!;
    const after = sortSections(list.map((s) => ({ ...s, sort: down.find((u) => u.id === s.id)?.sort ?? s.sort })));
    expect(after.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("the profile as the assistant reads it", () => {
  const info = {
    student: { name: "Sam", gpa: "3.9", test_scores: "", intended_major: "Engineering", about: "Builds robots." },
    sections: [
      { id: "s1", title: "Robotics", body: "Captain of the team." },
      { id: "s2", title: "", body: "" },
    ],
  };

  it("lists every section with its id", () => {
    const out = renderProfile(info);
    expect(out).toContain("GPA: 3.9");
    expect(out).toContain("Intended major: Engineering");
    expect(out).not.toContain("Test scores");
    expect(out).toContain("### Robotics [section_id: s1]");
    expect(out).toContain("### (untitled) [section_id: s2]");
    expect(out).toContain("Builds robots.");
  });

  it("says how to start when there are no sections", () => {
    expect(renderProfile({ student: null, sections: [] })).toContain("save_profile_section");
    expect(profileForPiece({ student: null, sections: [] })).toBe("");
  });

  it("carries the profile under a piece, cut to size", () => {
    const long = { student: null, sections: Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, title: `T${i}`, body: "x".repeat(100) })) };
    const out = profileForPiece(long, 250);
    expect(out).toContain("### T0");
    expect(out).toContain("### T1");
    expect(out).not.toContain("### T2");
    expect(out).toContain("[…more in read_profile]");
  });
});
