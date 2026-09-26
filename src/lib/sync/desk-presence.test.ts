import { describe, expect, it } from "vitest";
import { byPiece, type Here } from "./desk-presence";

const h = (user: string, piece: string): Here => ({ user, name: user, color: "#000", piece });

describe("byPiece", () => {
  it("groups everyone else by the piece they have open", () => {
    const m = byPiece([h("mom", "a"), h("dad", "b"), h("claude", "a")]);
    expect(m.get("a")?.map((x) => x.user)).toEqual(["mom", "claude"]);
    expect(m.get("b")?.map((x) => x.user)).toEqual(["dad"]);
    expect(m.get("c")).toBeUndefined();
  });
});
