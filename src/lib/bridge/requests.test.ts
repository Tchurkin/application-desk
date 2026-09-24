import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assistantLabel,
  assistantUrl,
  bridgeMissing,
  handoffMessage,
  preferredAssistant,
  setPreferredAssistant,
  storedAssistant,
  subscribeAssistant,
} from "./requests";

function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

afterEach(() => vi.unstubAllGlobals());

describe("the handoff", () => {
  it("opens Claude or ChatGPT with the message filled in", () => {
    const msg = handoffMessage("ask");
    expect(msg).toContain("list_desk_requests");
    expect(assistantUrl("claude", msg)).toBe(`https://claude.ai/new?q=${encodeURIComponent(msg)}`);
    expect(assistantUrl("chatgpt", msg)).toBe(`https://chatgpt.com/?q=${encodeURIComponent(msg)}`);
    expect(handoffMessage("odds")).toContain("set_college_strategy");
    expect(assistantLabel("chatgpt")).toBe("ChatGPT");
    expect(assistantLabel("claude")).toBe("Claude");
  });
});

describe("the remembered assistant", () => {
  it("defaults to Claude when nothing is stored or storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(storedAssistant()).toBeNull();
    expect(preferredAssistant()).toBe("claude");
  });

  it("remembers the choice and tells every subscriber", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const heard = vi.fn();
    const stop = subscribeAssistant(heard);
    setPreferredAssistant("chatgpt");
    expect(storedAssistant()).toBe("chatgpt");
    expect(preferredAssistant()).toBe("chatgpt");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    setPreferredAssistant("claude");
    expect(heard).toHaveBeenCalledTimes(1);
    expect(preferredAssistant()).toBe("claude");
  });
});

describe("bridgeMissing", () => {
  it("recognises a database that is a migration behind", () => {
    expect(bridgeMissing({ code: "PGRST205" })).toBe(true);
    expect(bridgeMissing({ code: "42P01" })).toBe(true);
    expect(bridgeMissing({ code: "PGRST202" })).toBe(true);
    expect(bridgeMissing({ code: "42501" })).toBe(false);
    expect(bridgeMissing(null)).toBe(false);
  });
});
