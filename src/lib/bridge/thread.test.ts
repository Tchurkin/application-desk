import { describe, expect, it } from "vitest";
import type { DeskRequest } from "./requests";
import { clip, hasWaiting, inThread, mergeRequest, removeRequest, sortThread, timeOf, whenLabel } from "./thread";

const PIECE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function req(id: string, over: Partial<DeskRequest> = {}): DeskRequest {
  return {
    id,
    desk_id: "d",
    piece_id: PIECE,
    kind: "ask",
    prompt: `question ${id}`,
    selection: "",
    status: "pending",
    answer: "",
    answered_by: "",
    created_at: "2026-09-23T14:00:00.000000+00:00",
    answered_at: null,
    ...over,
  };
}

describe("timeOf", () => {
  it("reads PostgREST and Realtime timestamps alike, microseconds and all", () => {
    const a = timeOf("2026-09-23T14:02:03.123456+00:00");
    expect(a).toBe(Date.UTC(2026, 8, 23, 14, 2, 3, 123));
    expect(timeOf("2026-09-23 14:02:03.123456")).toBe(a);
    expect(timeOf("2026-09-23T16:02:03.123+02:00")).toBe(a);
    expect(Number.isNaN(timeOf(null))).toBe(true);
  });
});

describe("the thread", () => {
  it("keeps this piece's questions and polish requests, oldest first, without dismissed or odds ones", () => {
    const rows = [
      req("c", { created_at: "2026-09-23T14:03:00+00:00" }),
      req("a", { created_at: "2026-09-23T14:01:00.5+00:00", kind: "polish", selection: "A line." }),
      req("x", { status: "dismissed" }),
      req("y", { kind: "odds", piece_id: null }),
      req("z", { piece_id: OTHER }),
      req("b", { created_at: "2026-09-23T14:02:00+00:00" }),
    ];
    expect(sortThread(rows, PIECE).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("adds a new request, replaces it when answered, and drops it once dismissed", () => {
    let list = sortThread([req("a")], PIECE);
    list = mergeRequest(list, req("b", { created_at: "2026-09-23T14:05:00+00:00" }), PIECE);
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    list = mergeRequest(list, req("a", { status: "answered", answer: "Yes.", answered_by: "Claude" }), PIECE);
    expect(list.map((r) => [r.id, r.status])).toEqual([
      ["a", "answered"],
      ["b", "pending"],
    ]);
    expect(hasWaiting(list)).toBe(true);
    list = mergeRequest(list, req("b", { status: "dismissed" }), PIECE);
    expect(list.map((r) => r.id)).toEqual(["a"]);
    expect(hasWaiting(list)).toBe(false);
  });

  it("ignores other pieces' rows and keeps the same array when nothing changed", () => {
    const list = [req("a")];
    expect(mergeRequest(list, req("q", { piece_id: OTHER }), PIECE)).toBe(list);
    expect(removeRequest(list, "nope")).toBe(list);
    expect(removeRequest(list, "a")).toEqual([]);
  });

  it("knows what belongs", () => {
    expect(inThread(req("a"), PIECE)).toBe(true);
    expect(inThread(req("a", { kind: "odds" }), PIECE)).toBe(false);
    expect(inThread(req("a", { status: "dismissed" }), PIECE)).toBe(false);
  });
});

describe("clip", () => {
  it("collapses whitespace and cuts long passages with an ellipsis", () => {
    expect(clip("  one\n\ntwo   three ", 50)).toBe("one two three");
    const cut = clip("a".repeat(200), 160);
    expect(cut).toHaveLength(160);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("whenLabel", () => {
  const now = Date.UTC(2026, 8, 23, 15, 0, 0);
  it("says how long ago for the last hour", () => {
    expect(whenLabel("2026-09-23T14:59:40+00:00", now)).toBe("just now");
    expect(whenLabel("2026-09-23T14:48:00+00:00", now)).toBe("12 min ago");
    expect(whenLabel("2026-09-23T15:00:10+00:00", now)).toBe("just now");
  });
  it("gives a time after that, and nothing for a missing time", () => {
    expect(whenLabel("2026-09-20T09:00:00+00:00", now)).not.toMatch(/ago|just now/);
    expect(whenLabel(null, now)).toBe("");
  });
});
