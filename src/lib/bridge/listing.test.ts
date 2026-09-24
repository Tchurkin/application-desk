import { describe, expect, it } from "vitest";
import { LIST_MAX, PASSAGE_MAX, renderRequest, renderRequestList, type PendingRequest } from "./listing";

const PIECE = "11111111-1111-4111-8111-111111111111";

function row(id: string, over: Partial<PendingRequest> = {}): PendingRequest {
  return {
    id,
    kind: "ask",
    piece_id: PIECE,
    piece_title: "Why Northfield?",
    prompt: "Is my opening strong enough?",
    selection: "",
    created_at: "2026-09-23T14:02:03.123456+00:00",
    ...over,
  };
}

describe("renderRequestList", () => {
  it("says plainly when nothing is waiting", () => {
    expect(renderRequestList([])).toContain("Nothing is waiting");
  });

  it("lists a question with its ids, the pointed-at passage, and what to call", () => {
    const t = renderRequestList([row("r1", { selection: "It was very good at it." })]);
    expect(t).toContain("1 request waiting");
    expect(t).toContain("[request_id: r1]");
    expect(t).toContain(`Piece: "Why Northfield?" [piece_id: ${PIECE}]`);
    expect(t).toContain("Is my opening strong enough?");
    expect(t).toContain('"""\nIt was very good at it.\n"""');
    expect(t).toContain(`read_piece with piece_id ${PIECE}, then answer_request with request_id r1`);
    expect(t).toContain("Sent: 2026-09-23 14:02 UTC");
  });

  it("tells the assistant to polish through suggest_edits with the passage as find", () => {
    const t = renderRequestList([row("p1", { kind: "polish", prompt: "", selection: "My robot sorted cans." })]);
    expect(t).toContain("rewordings of a passage [request_id: p1] (kind: polish)");
    expect(t).toContain("use it exactly as `find`");
    expect(t).toContain("My robot sorted cans.");
    expect(t).toContain("suggest_edits once on that piece with 2 or 3 edits");
    expect(t).toContain("answer_request with request_id p1");
    expect(t).not.toContain("What the student wants");
  });

  it("asks for a highlight when a polish request has no passage", () => {
    expect(renderRequestList([row("p2", { kind: "polish", selection: " " })])).toContain("none was selected");
  });

  it("sends odds requests to read_strategy and set_college_strategy", () => {
    const t = renderRequestList([row("o1", { kind: "odds", piece_id: null, piece_title: null, prompt: "" })]);
    expect(t).toContain("admission odds for every college [request_id: o1]");
    expect(t).toContain("read_strategy, then set_college_strategy for each college");
    expect(t).toContain("answer_request with request_id o1");
    expect(t).not.toContain("piece_id");
  });

  it("says the piece is already there when it was sent along, so read_piece isn't needed", () => {
    const t = renderRequestList([row("r1")], { included: { pieces: new Set([PIECE]) } });
    expect(t).toContain("is included below");
    expect(t).not.toContain("call read_piece");
    expect(t).toContain("answer_request with request_id r1");
  });

  it("lets the counselor answer by replying, for every kind", () => {
    const kinds = ["ask", "polish", "odds", "interview", "chat"] as const;
    for (const kind of kinds) {
      const t = renderRequest(row(`k-${kind}`, { kind, selection: kind === "polish" ? "My robot." : "" }), {
        answer: "reply",
        included: { pieces: new Set([PIECE]), strategy: true, profile: true },
      });
      expect(t, kind).toContain(`(kind: ${kind})`);
      expect(t, kind).toContain("don't call answer_request");
      expect(t, kind).not.toMatch(/call answer_request with/);
      expect(t, kind).not.toContain("read_strategy,");
    }
  });

  it("passes a chat message on as it was written", () => {
    const t = renderRequestList([row("c1", { kind: "chat", piece_id: null, piece_title: null, prompt: "What should I work on this week?" })]);
    expect(t).toContain("a message from the student [request_id: c1] (kind: chat)");
    expect(t).toContain("What should I work on this week?");
    expect(t).toContain("Reply with answer_request with request_id c1");
  });

  it("caps how many it lists and how long a passage runs", () => {
    const many = Array.from({ length: LIST_MAX + 3 }, (_, i) => row(`r${i}`));
    const t = renderRequestList(many);
    expect(t).toContain(`${LIST_MAX + 3} requests waiting`);
    expect(t).toContain(`Showing the first ${LIST_MAX}`);
    expect(t).not.toContain(`[request_id: r${LIST_MAX}]`);
    const long = renderRequestList([row("l", { selection: "x".repeat(PASSAGE_MAX + 50) })]);
    expect(long).toContain("[…cut here: read_piece has the whole text]");
  });
});
