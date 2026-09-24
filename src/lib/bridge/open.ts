import { assistantUrl, handoffMessage, type Assistant, type RequestKind } from "./requests";

/*
 * Opening the student's assistant with the handoff message filled in. Call it straight from the
 * click, before any await, so the browser still counts the new tab as the student's own action.
 * When a popup blocker stops it anyway, the caller shows a link and the message is copied.
 */

export interface Handoff {
  url: string;
  message: string;
  opened: boolean;
}

export function openAssistant(assistant: Assistant, kind: RequestKind): Handoff {
  const message = handoffMessage(kind);
  const url = assistantUrl(assistant, message);
  let opened = false;
  try {
    // Not "noopener": that makes window.open return null even on success, hiding a block.
    const w = window.open(url, "_blank");
    if (w) {
      opened = true;
      try {
        w.opener = null;
      } catch {
        // Already cross-origin: nothing to cut.
      }
    }
  } catch {
    // Some embedded browsers throw instead of returning null.
  }
  return { url, message, opened };
}

/** Put the handoff message on the clipboard; false when the browser refuses. */
export async function copyHandoff(message: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(message);
    return true;
  } catch {
    return false;
  }
}
