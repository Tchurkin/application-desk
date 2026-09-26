import { describe, expect, it } from "vitest";
import {
  countLabel,
  groupMeta,
  nextVersionTitle,
  pickCollegePiece,
  pieceToWrite,
  railOrder,
  SHARED,
  stepPiece,
  tabLabel,
  versionFamily,
  withVersionsAfter,
  type RailCollege,
  type RailPiece,
} from "./rail";

const TODAY = "2030-10-01";
const college = (id: string, deadline: string | null = null): RailCollege => ({ id, name: `College ${id}`, deadline });
const piece = (id: string, college_id: string | null, over: Partial<RailPiece> = {}): RailPiece => ({
  id,
  college_id,
  title: id,
  status: "drafting",
  word_count: 0,
  limit_kind: "words",
  limit_value: null,
  ...over,
});

describe("railOrder", () => {
  it("puts upcoming deadlines first, then passed, then undated; fully submitted last", () => {
    const cs = [
      college("undated"),
      college("later", "2030-12-01"),
      college("passed", "2030-09-01"),
      college("sooner", "2030-11-01"),
      college("done", "2030-10-05"),
    ];
    const ps = [
      piece("u1", "undated"),
      piece("l1", "later"),
      piece("p1", "passed"),
      piece("s1", "sooner"),
      piece("d1", "done", { status: "submitted" }),
    ];
    expect(railOrder(cs, ps, TODAY).map((g) => g.key)).toEqual(["sooner", "later", "passed", "undated", "done"]);
  });

  it("uses a piece's own due date, and only the work still left", () => {
    const cs = [college("a", "2030-12-01"), college("b", "2030-11-15")];
    const ps = [
      // a's early piece is finished, but its other piece is due before anything at b.
      piece("a1", "a", { due: "2030-10-10", status: "final" }),
      piece("a2", "a", { due: "2030-11-01" }),
      piece("b1", "b"),
    ];
    const rows = railOrder(cs, ps, TODAY);
    expect(rows.map((g) => g.key)).toEqual(["a", "b"]);
    expect(rows[0].due).toBe("2030-11-01");
    expect(rows[0].done).toBe(1);
  });

  it("counts final and submitted as done, but only all-submitted as finished", () => {
    const rows = railOrder([college("a", "2030-11-01")], [piece("a1", "a", { status: "final" }), piece("a2", "a", { status: "submitted" })], TODAY);
    expect(rows[0].done).toBe(2);
    expect(rows[0].finished).toBe(false);
  });

  it("breaks ties by name and keeps colleges with no pieces", () => {
    const cs = [
      { id: "z", name: "Zeta", deadline: "2030-11-01" },
      { id: "a", name: "Alpha", deadline: "2030-11-01" },
    ];
    const rows = railOrder(cs, [], TODAY);
    expect(rows.map((g) => g.name)).toEqual(["Alpha", "Zeta"]);
    expect(rows[0].total).toBe(0);
    expect(rows[0].due).toBe("2030-11-01");
  });

  it("puts shared pieces first, or with the finished ones once all are submitted", () => {
    const cs = [college("a", "2030-11-01"), college("f", "2030-10-02")];
    const open = railOrder(cs, [piece("s", null), piece("a1", "a"), piece("f1", "f", { status: "submitted" })], TODAY);
    expect(open.map((g) => g.key)).toEqual([SHARED, "a", "f"]);
    const done = railOrder(cs, [piece("s", null, { status: "submitted" }), piece("a1", "a"), piece("f1", "f", { status: "submitted" })], TODAY);
    expect(done.map((g) => g.key)).toEqual(["a", SHARED, "f"]);
  });

  it("lists a piece's versions right after it", () => {
    const rows = railOrder(
      [college("a", "2030-11-01")],
      [piece("orig", "a"), piece("other", "a"), piece("v2", "a", { variant_of: "orig" })],
      TODAY,
    );
    expect(rows[0].pieces.map((p) => p.id)).toEqual(["orig", "v2", "other"]);
  });
});

describe("pickCollegePiece", () => {
  it("lands on the first piece still being worked on", () => {
    const ps = [piece("a", "c", { status: "final" }), piece("b", "c", { status: "not_started" }), piece("c", "c")];
    expect(pickCollegePiece(ps)?.id).toBe("b");
  });
  it("falls back to the first piece when everything is done, and to null when there are none", () => {
    expect(pickCollegePiece([piece("a", "c", { status: "submitted" }), piece("b", "c", { status: "final" })])?.id).toBe("a");
    expect(pickCollegePiece([])).toBeNull();
  });
});

describe("stepPiece", () => {
  it("moves through pieces in rail order across colleges", () => {
    const rows = railOrder([college("a", "2030-10-10"), college("b", "2030-11-10")], [piece("b1", "b"), piece("a1", "a"), piece("a2", "a")], TODAY);
    expect(stepPiece(rows, "a2", 1)?.id).toBe("b1");
    expect(stepPiece(rows, "b1", -1)?.id).toBe("a2");
    expect(stepPiece(rows, "b1", 1)).toBeNull();
  });
});

describe("labels", () => {
  it("strips a leading number from tab labels", () => {
    expect(tabLabel("1 · Why us?")).toBe("Why us?");
    expect(tabLabel("2. Community")).toBe("Community");
    expect(tabLabel("3) Activity")).toBe("Activity");
    expect(tabLabel("2030 plans")).toBe("2030 plans");
    expect(tabLabel("42")).toBe("42");
  });

  it("counts against the limit when there is one", () => {
    expect(countLabel({ words: 212, kind: "words", limit: 250 })).toBe("212/250");
    expect(countLabel({ words: 340, kind: "none", limit: null })).toBe("340w");
    expect(countLabel({ words: 150, chars: 900, kind: "chars", limit: 1000 })).toBe("900/1000c");
    expect(countLabel({ words: 150, kind: "chars", limit: 1000 })).toBe("150w");
  });

  it("describes a college's pieces", () => {
    expect(groupMeta({ total: 3, done: 1, due: "2030-11-01" })).toBe("3 pieces · 1 done · Nov 1");
    expect(groupMeta({ total: 1, done: 0, due: null })).toBe("1 piece · 0 done");
    expect(groupMeta({ total: 0, done: 0, due: null })).toBe("No pieces yet");
  });
});

describe("versions", () => {
  const ps = [piece("root", "a", { title: "Why us?" }), piece("x", "a"), piece("v2", "a", { variant_of: "root" }), piece("v3", "a", { variant_of: "root" })];

  it("finds the family from the original or from any version", () => {
    expect(versionFamily(ps, ps[0]).map((p) => p.id)).toEqual(["root", "v2", "v3"]);
    expect(versionFamily(ps, ps[3]).map((p) => p.id)).toEqual(["root", "v2", "v3"]);
    expect(versionFamily(ps, ps[1]).map((p) => p.id)).toEqual(["x"]);
  });

  it("treats a version whose original was deleted as an original", () => {
    const orphan = piece("v", "a", { variant_of: "gone" });
    expect(versionFamily([orphan], orphan).map((p) => p.id)).toEqual(["v"]);
    expect(withVersionsAfter([orphan]).map((p) => p.id)).toEqual(["v"]);
  });

  it("names the next version", () => {
    expect(nextVersionTitle("Why us?", 1)).toBe("Why us? (version 2)");
    expect(nextVersionTitle("Why us? (version 2)", 2)).toBe("Why us? (version 3)");
  });
});

describe("pieceToWrite", () => {
  const colleges = [college("a", "2030-11-01"), college("b", "2030-10-15")];
  const pieces = [
    piece("a1", "a"),
    piece("b1", "b", { status: "final" }),
    piece("b2", "b"),
    piece("solo", null, { due: "2030-10-20" }),
  ];

  it("opens the piece last open, while it's still there", () => {
    expect(pieceToWrite(colleges, pieces, "a1")).toBe("a1");
    expect(pieceToWrite(colleges, pieces, "gone")).toBe("b2");
  });

  it("else the unfinished piece due soonest, by its own date or its college's deadline", () => {
    expect(pieceToWrite(colleges, pieces)).toBe("b2");
    expect(pieceToWrite(colleges, pieces.filter((p) => p.id !== "b2"))).toBe("solo");
  });

  it("else any piece, and nothing on an empty desk", () => {
    expect(pieceToWrite(colleges, [piece("done", "a", { status: "submitted" })])).toBe("done");
    expect(pieceToWrite(colleges, [])).toBeNull();
  });
});
