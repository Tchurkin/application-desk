import { describe, expect, it } from "vitest";
import { fuzzyScore, rank } from "./fuzzy";
import { clampSide, nudgeSide, parseTool, parseWidth, SIDE_DEFAULT, SIDE_MIN, sideMax } from "./layout";
import { clip, notesSummary, relativeTime } from "./text";

describe("side panel width", () => {
  it("clamps between the minimum and 62% of the window", () => {
    expect(clampSide(100, 1280)).toBe(SIDE_MIN);
    expect(clampSide(300, 1280)).toBe(300);
    expect(clampSide(5000, 1280)).toBe(Math.floor(1280 * 0.62));
    // A window too small for the maximum still allows the minimum.
    expect(clampSide(400, 300)).toBe(SIDE_MIN);
    expect(clampSide(NaN, 1280)).toBe(SIDE_DEFAULT);
  });

  it("reads a remembered width, ignoring nonsense", () => {
    expect(parseWidth("318")).toBe(318);
    expect(parseWidth(null)).toBe(SIDE_DEFAULT);
    expect(parseWidth("wide")).toBe(SIDE_DEFAULT);
    expect(parseWidth("-5")).toBe(SIDE_DEFAULT);
  });

  it("moves with the arrow keys, further with Shift, and resets with Enter", () => {
    expect(nudgeSide(282, "ArrowRight", false, 1280)).toBe(294);
    expect(nudgeSide(282, "ArrowLeft", true, 1280)).toBe(242);
    expect(nudgeSide(230, "ArrowLeft", true, 1280)).toBe(SIDE_MIN);
    expect(nudgeSide(400, "Home", false, 1280)).toBe(SIDE_MIN);
    expect(nudgeSide(300, "End", false, 1280)).toBe(sideMax(1280));
    expect(nudgeSide(500, "Enter", false, 1280)).toBe(SIDE_DEFAULT);
    expect(nudgeSide(300, "a", false, 1280)).toBeNull();
  });

  it("remembers only known tools", () => {
    expect(parseTool("history")).toBe("history");
    expect(parseTool("chat")).toBe("files");
    expect(parseTool(null)).toBe("files");
  });
});

describe("fuzzy matching", () => {
  it("matches letters in order and prefers word starts and substrings", () => {
    expect(fuzzyScore("wn", "Why Northfield?")).not.toBeNull();
    expect(fuzzyScore("xyz", "Why Northfield?")).toBeNull();
    expect(fuzzyScore("north", "Why Northfield?")!).toBeGreaterThan(fuzzyScore("nfd", "Why Northfield?")!);
  });

  it("ranks the best matches first and keeps everything for an empty query", () => {
    const items = ["Community", "Why Northfield?", "Northfield University", "Board"];
    expect(rank(items, "north", (s) => s)).toEqual(["Northfield University", "Why Northfield?"]);
    expect(rank(items, "", (s) => s)).toEqual(items);
  });
});

describe("text helpers", () => {
  it("summarizes notes as their first real line without markdown", () => {
    expect(notesSummary("\n\n## **Mention** the _robotics_ lab\nsecond line")).toBe("Mention the robotics lab");
    expect(notesSummary("   ")).toBe("");
    expect(notesSummary("x".repeat(120))).toHaveLength(90);
    expect(notesSummary("x".repeat(120)).endsWith("…")).toBe(true);
  });

  it("says how long ago", () => {
    const now = Date.parse("2030-10-01T12:00:00Z");
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(relativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe("3 hr ago");
    expect(relativeTime(now - 86_400_000, now)).toBe("1 day ago");
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/2030/);
  });

  it("clips long messages", () => {
    expect(clip("short")).toBe("short");
    expect(clip("y".repeat(100))).toHaveLength(72);
  });
});
