import { describe, expect, it } from "vitest";
import { asLetterStatus, colorOf, letterCount, lettersFor, nextColor, withLetter, type Letter, type Recommender } from "./letters";

const rec = (id: string, color: number, created_at: string, name = id): Recommender => ({ id, name, role: "", color, created_at });

const RIVERA = rec("r1", 0, "2030-01-01T00:00:00Z", "Ms. Rivera");
const CHEN = rec("r2", 1, "2030-01-02T00:00:00Z", "Mr. Chen");

describe("letters", () => {
  const letters: Letter[] = [
    { college_id: "c1", recommender_id: "r2", status: "submitted" },
    { college_id: "c1", recommender_id: "r1", status: "requested" },
    { college_id: "c2", recommender_id: "r1", status: "planned" },
    { college_id: "c1", recommender_id: "gone", status: "planned" },
  ];

  it("lists a college's letters in the order recommenders were added", () => {
    expect(lettersFor("c1", letters, [CHEN, RIVERA]).map((x) => x.recommender.name)).toEqual(["Ms. Rivera", "Mr. Chen"]);
    expect(lettersFor("c3", letters, [CHEN, RIVERA])).toEqual([]);
  });

  it("counts a recommender's letters and the ones sent", () => {
    expect(letterCount("r1", letters)).toBe("2 letters");
    expect(letterCount("r2", letters)).toBe("1 letter, 1 sent");
    expect(letterCount("r9", letters)).toBe("no letters yet");
  });

  it("sets and takes off one letter", () => {
    const set = withLetter(letters, "r2", "c2", "requested");
    expect(set.find((l) => l.recommender_id === "r2" && l.college_id === "c2")?.status).toBe("requested");
    const changed = withLetter(set, "r2", "c2", "submitted");
    expect(changed.filter((l) => l.recommender_id === "r2" && l.college_id === "c2")).toHaveLength(1);
    expect(withLetter(changed, "r2", "c2", null).some((l) => l.recommender_id === "r2" && l.college_id === "c2")).toBe(false);
  });

  it("reads unknown statuses as not asked yet", () => {
    expect(asLetterStatus("submitted")).toBe("submitted");
    expect(asLetterStatus("sent")).toBe("planned");
  });
});

describe("recommender colors", () => {
  it("hands out the least used color, the first on a tie", () => {
    expect(nextColor([])).toBe(0);
    expect(nextColor([RIVERA, CHEN])).toBe(2);
    const all = Array.from({ length: 8 }, (_, i) => rec(`x${i}`, i, `2030-01-0${i + 1}`));
    expect(nextColor(all)).toBe(0);
    expect(nextColor([...all, rec("y", 0, "2030-02-01")])).toBe(1);
  });

  it("keeps any stored value inside the palette", () => {
    expect(colorOf({ color: 9 })).toBe(1);
    expect(colorOf({ color: -1 })).toBe(7);
    expect(colorOf({ color: Number.NaN })).toBe(0);
  });
});
