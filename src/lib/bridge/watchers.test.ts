import { describe, expect, it } from "vitest";
import { activityOn, activityText, counselors, isCounselor, watcher, type Connector } from "./watchers";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();

const chat: Connector = { id: "a", label: "ChatGPT", last_used_at: null, watched_at: ago(10) };
const counselor: Connector = {
  id: "b",
  label: "Claude",
  last_used_at: null,
  watched_at: ago(5),
  counselor_at: ago(5),
  activity: { tool: "read_piece", piece: "Why us", request: "r1" },
  activity_at: ago(3),
};

describe("who is watching", () => {
  it("prefers the counselor, and only counts recent check-ins", () => {
    expect(watcher([chat, counselor], NOW)?.id).toBe("b");
    expect(watcher([chat], NOW)?.id).toBe("a");
    expect(watcher([{ ...chat, watched_at: ago(600) }], NOW)).toBeNull();
    expect(isCounselor(counselor, NOW)).toBe(true);
    expect(isCounselor(chat, NOW)).toBe(false);
  });

  it("lists counselors, most recently seen first", () => {
    const older = { ...counselor, id: "c", counselor_at: ago(3600) };
    expect(counselors([older, chat, counselor]).map((c) => c.id)).toEqual(["b", "c"]);
    expect(counselors(null)).toEqual([]);
  });
});

describe("what it is doing", () => {
  it("says what the last tool was, while it's recent", () => {
    expect(activityText(counselor, NOW)).toBe("reading “Why us”");
    expect(activityText({ ...counselor, activity_at: ago(600) }, NOW)).toBeNull();
    expect(activityText({ ...counselor, activity: { tool: "idle" } }, NOW)).toBeNull();
    expect(activityText({ ...counselor, activity: { tool: "set_college_strategy" } }, NOW)).toBe("setting your odds");
  });

  it("ties it to the request being worked on", () => {
    expect(activityOn([chat, counselor], "r1", NOW)).toBe("reading “Why us”");
    expect(activityOn([chat, counselor], "r2", NOW)).toBeNull();
  });
});
