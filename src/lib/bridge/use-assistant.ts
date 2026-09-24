"use client";
import { useSyncExternalStore } from "react";
import { setPreferredAssistant, storedAssistant, subscribeAssistant, type Assistant } from "./requests";

/**
 * The assistant this browser answers with, and a setter that remembers it. Until the student
 * picks one, `fallback` decides (for example the assistant their connector link is for). The
 * server render always says Claude, so hydration never disagrees with the page.
 */
export function useAssistant(fallback: Assistant = "claude"): [Assistant, (a: Assistant) => void] {
  const stored = useSyncExternalStore(subscribeAssistant, storedAssistant, () => null);
  return [stored ?? fallback, setPreferredAssistant];
}
