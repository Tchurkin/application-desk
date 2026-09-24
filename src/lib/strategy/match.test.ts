import { describe, expect, it } from "vitest";
import data from "@/data/admission-rates.json";
import { buildIndex, candidates, lookup, normalizeName, type CatalogEntry } from "./match";

const entry = (id: number, name: string, alias?: string): CatalogEntry => ({ id, name, alias, city: "Town", state: "ST", rate: 0.5 });

describe("catalog matching", () => {
  const ix = buildIndex([
    entry(1, "University of Michigan-Ann Arbor", "U of Michigan|Univ of Michigan"),
    entry(2, "University of Michigan-Dearborn", "UM-Dearborn"),
    entry(3, "University of Michigan-Flint"),
    entry(4, "Purdue University-Main Campus", "Purdue"),
    entry(5, "Purdue University Northwest"),
    entry(6, "Academy of Interactive Entertainment", "AIE"),
    entry(7, "Academy of Interactive Entertainment", "AIE"),
    entry(8, "Coastal State University-North"),
  ]);

  it("normalizes filler words, punctuation and abbreviations", () => {
    expect(normalizeName("The Univ. of Michigan")).toBe("university michigan");
    expect(normalizeName("Purdue University-Main Campus")).toBe("purdue university");
    expect(normalizeName("Texas A&M")).toBe("texas a and m");
  });

  it("matches a full name, a main campus without its suffix, and an alias", () => {
    expect(lookup(ix, "Purdue University-Main Campus")?.id).toBe(4);
    expect(lookup(ix, "Purdue University")?.id).toBe(4);
    expect(lookup(ix, "purdue")?.id).toBe(4);
    expect(lookup(ix, "UM-Dearborn")?.id).toBe(2);
  });

  it("prefers a college's own alias over campuses that only share the prefix", () => {
    expect(lookup(ix, "University of Michigan")?.id).toBe(1);
  });

  it("uses a shared prefix when it points at one college", () => {
    expect(lookup(ix, "Coastal State University")?.id).toBe(8);
  });

  it("guesses at nothing when several colleges share a name, and lists them", () => {
    expect(lookup(ix, "Academy of Interactive Entertainment")).toBeNull();
    expect(candidates(ix, "Academy of Interactive Entertainment").map((c) => c.id)).toEqual([6, 7]);
    expect(lookup(ix, "Northfield University")).toBeNull();
    expect(candidates(ix, "Northfield University")).toEqual([]);
  });

  it("a scorecard id picks the college outright", () => {
    expect(lookup(ix, "Academy of Interactive Entertainment", 7)?.id).toBe(7);
    expect(lookup(ix, "anything", 3)?.id).toBe(3);
    expect(lookup(ix, "Purdue", 999)?.id).toBe(4);
  });

  // The names the e2e test relies on, against the bundled catalog.
  it("finds the real catalog colleges the Strategy e2e test uses", () => {
    const real = buildIndex((data as { schools: CatalogEntry[] }).schools);
    expect(lookup(real, "Purdue University-Main Campus")?.rate).toBe(0.499);
    expect(lookup(real, "Massachusetts Institute of Technology")?.rate).toBe(0.045);
    expect(lookup(real, "University of Arizona")?.rate).toBe(0.861);
    expect(lookup(real, "University of Michigan")?.name).toBe("University of Michigan-Ann Arbor");
    expect(lookup(real, "Northfield University")).toBeNull();
  });
});
