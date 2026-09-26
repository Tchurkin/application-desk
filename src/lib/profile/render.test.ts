import { describe, expect, it } from "vitest";
import { profileInContext, renderProfile, renderProfilePart, type ProfileInfo } from "./render";

const section = (i: number, size: number) => ({ id: `00000000-0000-0000-0000-00000000000${i}`, title: `Section ${i}`, body: `${i}`.repeat(size) });
const profile = (sizes: number[]): ProfileInfo => ({ student: { name: "Testy", gpa: "3.9" }, sections: sizes.map((s, i) => section(i + 1, s)) });

describe("read_profile in parts", () => {
  it("is the whole profile, in one part, when it fits", () => {
    const p = profile([500, 800]);
    expect(renderProfilePart(p)).toEqual({ text: renderProfile(p), part: 1, parts: 1 });
  });

  it("splits a long profile at whole sections, lists every section first, and says how to go on", () => {
    const p = profile([18_000, 18_000, 18_000, 18_000, 18_000, 18_000]);
    const first = renderProfilePart(p, 1);
    expect(first.parts).toBeGreaterThan(1);
    expect(first.text).toContain("Name: Testy");
    for (let i = 1; i <= 6; i++) expect(first.text).toContain(`${i}. Section ${i}`);
    expect(first.text).toContain(`[Part 1 of ${first.parts}. Call read_profile with part: 2 for the rest.]`);
    // Every section is in exactly one part, whole.
    const all = Array.from({ length: first.parts }, (_, i) => renderProfilePart(p, i + 1).text);
    for (let i = 1; i <= 6; i++) expect(all.filter((t) => t.includes(`### Section ${i} [`)).length).toBe(1);
    for (const t of all) expect(t.length).toBeLessThan(62_000);
    expect(all.at(-1)).toContain("the end of the profile.");
    expect(renderProfilePart(p, 99).part).toBe(first.parts);
  });
});

describe("the profile in a request", () => {
  it("is whole when it fits", () => {
    const p = profile([1_000, 1_000]);
    expect(profileInContext(p, 30_000)).toBe(renderProfile(p));
  });

  it("keeps whole sections from the top, names the rest, and points to read_profile", () => {
    const p = profile([6_000, 6_000, 6_000, 6_000]);
    const text = profileInContext(p, 13_000);
    expect(text).toContain("### Section 1 [");
    expect(text).toContain("### Section 2 [");
    expect(text).not.toContain("### Section 3 [");
    expect(text).toContain("2 more sections (Section 3; Section 4)");
    expect(text).toContain("read it with read_profile");
    expect(text.length).toBeLessThan(13_600);
  });
});
