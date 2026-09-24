import { describe, expect, it } from "vitest";
import type { PieceStatus } from "@/lib/domain/colleges";
import { stageAt, stageCenter, stageForKey, stageIndex, stageLabel, STAGES, zoneFromX } from "./stages";

describe("stages", () => {
  it("runs Not started to Submitted, in the piece status order", () => {
    expect(STAGES).toEqual(["not_started", "drafting", "needs_review", "final", "submitted"]);
    expect(stageLabel("needs_review")).toBe("Needs review");
    expect(stageIndex("final")).toBe(3);
  });

  it("reads an unknown status as the first stage", () => {
    expect(stageIndex("archived" as PieceStatus)).toBe(0);
  });

  it("clamps stageAt to the ends", () => {
    expect(stageAt(-3)).toBe("not_started");
    expect(stageAt(9)).toBe("submitted");
    expect(stageAt(2.7)).toBe("needs_review");
  });

  it("centers a chip in its zone", () => {
    expect(stageCenter("not_started")).toBeCloseTo(0.1);
    expect(stageCenter("needs_review")).toBeCloseTo(0.5);
    expect(stageCenter("submitted")).toBeCloseTo(0.9);
  });
});

describe("zoneFromX", () => {
  const left = 100;
  const width = 500; // five zones of 100px

  it("is floor(x / width * 5) along the lane", () => {
    expect(zoneFromX(100, left, width)).toBe(0);
    expect(zoneFromX(199, left, width)).toBe(0);
    expect(zoneFromX(200, left, width)).toBe(1);
    expect(zoneFromX(350, left, width)).toBe(2);
    expect(zoneFromX(599, left, width)).toBe(4);
  });

  it("clamps a pointer past either end", () => {
    expect(zoneFromX(20, left, width)).toBe(0);
    expect(zoneFromX(600, left, width)).toBe(4);
    expect(zoneFromX(5000, left, width)).toBe(4);
  });

  it("survives a lane with no width (not laid out yet)", () => {
    expect(zoneFromX(150, left, 0)).toBe(0);
    expect(zoneFromX(150, left, Number.NaN)).toBe(0);
  });
});

describe("stageForKey", () => {
  it("moves one stage with the arrow keys", () => {
    expect(stageForKey("not_started", "ArrowRight")).toBe("drafting");
    expect(stageForKey("final", "ArrowLeft")).toBe("needs_review");
    expect(stageForKey("drafting", "ArrowUp")).toBe("needs_review");
    expect(stageForKey("drafting", "ArrowDown")).toBe("not_started");
  });

  it("stays put at the ends", () => {
    expect(stageForKey("submitted", "ArrowRight")).toBe("submitted");
    expect(stageForKey("not_started", "ArrowLeft")).toBe("not_started");
  });

  it("jumps to the ends with Home and End", () => {
    expect(stageForKey("final", "Home")).toBe("not_started");
    expect(stageForKey("drafting", "End")).toBe("submitted");
  });

  it("ignores other keys", () => {
    expect(stageForKey("drafting", "Enter")).toBeNull();
    expect(stageForKey("drafting", "a")).toBeNull();
  });
});
