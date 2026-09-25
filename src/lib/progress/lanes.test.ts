import { describe, expect, it } from "vitest";
import type { PieceStatus } from "@/lib/domain/colleges";
import {
  applyPieceChange,
  buildLanes,
  countLabel,
  countPhrase,
  finalCount,
  isFiled,
  nextPiece,
  pieceDue,
  pieceLaneKey,
  stageGroups,
  stageSummary,
  toProgressPiece,
  withPending,
  type ProgressCollege,
  type ProgressPiece,
} from "./lanes";

const TODAY = "2030-10-10";

const college = (id: string, deadline: string | null = null, name = `College ${id}`): ProgressCollege => ({
  id,
  name,
  deadline,
});

function piece(id: string, college_id: string | null, over: Partial<ProgressPiece> = {}): ProgressPiece {
  return {
    id,
    college_id,
    title: `Piece ${id}`,
    status: "drafting",
    word_count: 0,
    limit_kind: "words",
    limit_value: null,
    ...over,
  };
}

const order = (cs: ProgressCollege[], ps: ProgressPiece[]) => buildLanes(cs, ps, TODAY).map((l) => l.key);

describe("buildLanes order", () => {
  it("puts upcoming deadlines first, then passed, then undated", () => {
    const cs = [college("undated"), college("passed", "2030-10-01"), college("later", "2030-12-01"), college("soon", "2030-10-20")];
    const ps = cs.map((c) => piece(`${c.id}1`, c.id));
    expect(order(cs, ps)).toEqual(["soon", "later", "passed", "undated"]);
  });

  it("sinks a submitted college, even with the closest deadline, the latest submitted first", () => {
    const cs = [
      { ...college("early", "2030-10-11"), submitted_at: "2030-10-01T12:00:00Z" },
      { ...college("late", "2030-10-12"), submitted_at: "2030-10-08T12:00:00Z" },
      { ...college("open", "2030-12-01"), submitted_at: null },
    ];
    const lanes = buildLanes(cs, [piece("e1", "early"), piece("o1", "open")], TODAY);
    expect(lanes.map((l) => l.key)).toEqual(["open", "late", "early"]);
    expect(lanes[1]).toMatchObject({ submitted: true, submittedAt: "2030-10-08T12:00:00Z" });
    expect(lanes[0]).toMatchObject({ submitted: false, submittedAt: null });
  });

  it("files a submitted college away after a few days", () => {
    const lanes = buildLanes(
      [
        { ...college("fresh"), submitted_at: "2030-10-08T23:00:00Z" },
        { ...college("old"), submitted_at: "2030-10-06T09:00:00Z" },
        { ...college("open"), submitted_at: null },
      ],
      [],
      TODAY,
    );
    const filed = Object.fromEntries(lanes.map((l) => [l.key, isFiled(l, TODAY)]));
    expect(filed).toEqual({ fresh: false, old: true, open: false });
  });

  it("on a database without submitted_at, a college is submitted when every piece is", () => {
    const cs = [college("done", "2030-10-11"), college("open", "2030-12-01")];
    const ps = [
      piece("d1", "done", { status: "submitted" }),
      piece("d2", "done", { status: "submitted" }),
      piece("o1", "open"),
    ];
    const lanes = buildLanes(cs, ps, TODAY);
    expect(lanes.map((l) => l.key)).toEqual(["open", "done"]);
    expect(lanes[1].submitted).toBe(true);
  });

  it("does not sink a college with one piece still open", () => {
    const cs = [college("a", "2030-10-12"), college("b", "2030-10-11")];
    const ps = [piece("a1", "a", { status: "submitted" }), piece("a2", "a", { status: "final" }), piece("b1", "b")];
    expect(order(cs, ps)).toEqual(["b", "a"]);
  });

  it("uses the soonest due date among a college's pieces", () => {
    const cs = [college("a", "2030-12-01"), college("b", "2030-11-01")];
    const ps = [piece("a1", "a"), piece("a2", "a", { due: "2030-10-20" }), piece("b1", "b")];
    const lanes = buildLanes(cs, ps, TODAY);
    expect(lanes.map((l) => l.key)).toEqual(["a", "b"]);
    expect(lanes[0].due).toBe("2030-10-20");
  });

  it("breaks ties on the name", () => {
    const cs = [college("z", "2030-11-01", "Zeta"), college("a", "2030-11-01", "Alpha"), college("m", null, "Mu"), college("b", null, "Beta")];
    const ps = cs.map((c) => piece(`${c.id}1`, c.id));
    expect(order(cs, ps)).toEqual(["a", "z", "b", "m"]);
  });

  it("orders passed deadlines by date too", () => {
    const cs = [college("b", "2030-10-05"), college("a", "2030-09-01")];
    const ps = cs.map((c) => piece(`${c.id}1`, c.id));
    expect(order(cs, ps)).toEqual(["a", "b"]);
  });

  it("keeps colleges with no pieces, dated by their deadline and never submitted", () => {
    const lanes = buildLanes([college("empty", "2030-10-15"), college("x", "2030-11-01")], [piece("x1", "x")], TODAY);
    expect(lanes.map((l) => l.key)).toEqual(["empty", "x"]);
    expect(lanes[0]).toMatchObject({ due: "2030-10-15", submitted: false, pieces: [] });
  });

  it("gives each piece without a college a lane of its own, named for it", () => {
    const lanes = buildLanes(
      [college("a", "2030-11-01")],
      [piece("s1", null, { title: "Personal statement", due: "2030-10-20" }), piece("s2", null, { title: "Activities list" }), piece("a1", "a")],
      TODAY,
    );
    expect(lanes.map((l) => l.key)).toEqual([pieceLaneKey("s1"), "a", pieceLaneKey("s2")]);
    expect(lanes[0]).toMatchObject({ name: "Personal statement", college: null, due: "2030-10-20", submitted: false });
    expect(lanes[0].pieces.map((p) => p.id)).toEqual(["s1"]);
  });

  it("leaves out pieces of a college it doesn't know yet", () => {
    const lanes = buildLanes([college("a")], [piece("a1", "a"), piece("q1", "unknown")], TODAY);
    expect(lanes.flatMap((l) => l.pieces.map((p) => p.id))).toEqual(["a1"]);
  });

  it("orders a college's pieces by sort, then creation", () => {
    const ps = [
      piece("late", "a", { sort: 1, created_at: "2030-01-01T00:00:00Z" }),
      piece("new", "a", { sort: 0, created_at: "2030-02-01T00:00:00Z" }),
      piece("old", "a", { sort: 0, created_at: "2030-01-01T00:00:00Z" }),
    ];
    expect(buildLanes([college("a")], ps, TODAY)[0].pieces.map((p) => p.id)).toEqual(["old", "new", "late"]);
  });
});

describe("pieceDue", () => {
  it("prefers the piece's own date over the college deadline", () => {
    expect(pieceDue(piece("p", "a", { due: "2030-10-20" }), college("a", "2030-11-01"))).toBe("2030-10-20");
    expect(pieceDue(piece("p", "a"), college("a", "2030-11-01"))).toBe("2030-11-01");
    expect(pieceDue(piece("p", null), null)).toBeNull();
  });
});

describe("stage groups", () => {
  const ps = [
    piece("a", "c", { status: "final" }),
    piece("b", "c", { status: "drafting" }),
    piece("d", "c", { status: "final" }),
  ];

  it("counts final pieces, and ones sent with their application", () => {
    expect(finalCount([...ps, piece("e", "c", { status: "submitted" })])).toBe(3);
    expect(finalCount([])).toBe(0);
  });

  it("collects pieces by stage, in stage order, skipping empty stages", () => {
    const groups = stageGroups(ps);
    expect(groups.map((g) => g.stage)).toEqual(["drafting", "final"]);
    expect(groups[1].pieces.map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("summarizes a lane for screen readers", () => {
    expect(stageSummary(ps)).toBe("1 Drafting, 2 Final");
    expect(stageSummary([])).toBe("No pieces yet");
  });
});

describe("count labels", () => {
  it("shows words against a word limit", () => {
    expect(countLabel(piece("p", null, { word_count: 212, limit_value: 250 }))).toBe("212/250w");
    expect(countPhrase(piece("p", null, { word_count: 212, limit_value: 250 }))).toBe("212 of 250 words");
  });

  it("shows plain words without a limit", () => {
    expect(countLabel(piece("p", null, { word_count: 340 }))).toBe("340w");
    expect(countLabel(piece("p", null, { word_count: 340, limit_kind: "none", limit_value: 500 }))).toBe("340w");
    expect(countPhrase(piece("p", null, { word_count: 1 }))).toBe("1 word");
  });

  it("shows characters against a character limit when the count is loaded", () => {
    const p = piece("p", null, { word_count: 120, char_count: 812, limit_kind: "chars", limit_value: 1000 });
    expect(countLabel(p)).toBe("812/1000c");
    expect(countPhrase(p)).toBe("812 of 1000 characters");
    expect(countLabel({ ...p, char_count: undefined })).toBe("120w");
  });
});

describe("nextPiece", () => {
  it("opens the first unfinished piece, else the first", () => {
    const s = (id: string, status: PieceStatus) => piece(id, "c", { status });
    expect(nextPiece([s("a", "final"), s("b", "drafting"), s("c", "not_started")])?.id).toBe("b");
    expect(nextPiece([s("a", "final"), s("b", "submitted")])?.id).toBe("a");
    expect(nextPiece([])).toBeNull();
  });
});

describe("live changes", () => {
  const base = [piece("a", "c", { title: "Why us", word_count: 10 }), piece("b", "c")];

  it("keeps only the board's fields from a realtime row", () => {
    const p = toProgressPiece({
      id: "x",
      college_id: null,
      title: "Essay",
      status: "final",
      word_count: 5,
      char_count: 30,
      limit_kind: "chars",
      limit_value: 100,
      doc_state: "AAAA",
      plain_text: "secret words",
      due: "2030-11-01",
    });
    expect(p).toEqual({
      id: "x",
      college_id: null,
      title: "Essay",
      status: "final",
      word_count: 5,
      char_count: 30,
      limit_kind: "chars",
      limit_value: 100,
      due: "2030-11-01",
    });
    expect(toProgressPiece({ title: "no id" })).toBeNull();
    expect(toProgressPiece({ id: "y", status: "weird" })?.status).toBe("not_started");
    expect(toProgressPiece({ id: "z", status: "submitted" })?.status).toBe("submitted");
  });

  it("updates a piece in place", () => {
    const next = applyPieceChange(base, { type: "UPDATE", row: { id: "a", college_id: "c", title: "Why us", status: "final", word_count: 99 } });
    expect(next.map((p) => [p.id, p.status, p.word_count])).toEqual([
      ["a", "final", 99],
      ["b", "drafting", 0],
    ]);
    expect(base[0].status).toBe("drafting"); // not mutated
  });

  it("adds an inserted piece and drops a deleted one", () => {
    const added = applyPieceChange(base, { type: "INSERT", row: { id: "n", college_id: "c", title: "New", status: "not_started" } });
    expect(added.map((p) => p.id)).toEqual(["a", "b", "n"]);
    expect(applyPieceChange(added, { type: "DELETE", id: "a" }).map((p) => p.id)).toEqual(["b", "n"]);
  });

  it("returns the same array for a delete it doesn't hold", () => {
    expect(applyPieceChange(base, { type: "DELETE", id: "zzz" })).toBe(base);
  });

  it("shows moves still being saved", () => {
    const shown = withPending(base, new Map([["b", "submitted" as PieceStatus]]));
    expect(shown.map((p) => p.status)).toEqual(["drafting", "submitted"]);
    expect(withPending(base, new Map())).toBe(base);
  });
});
