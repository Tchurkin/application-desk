/*
 * The Write workspace's side panel: its width limits and the keys it is remembered under
 * (per browser; nothing about layout is stored on the server).
 */

export const SIDE_DEFAULT = 282;
export const SIDE_MIN = 220;
/** The panel never takes more than this share of the window. */
export const SIDE_MAX_SHARE = 0.62;
export const SIDE_STEP = 12;
export const SIDE_BIG_STEP = 40;

export const PREF = {
  sideWidth: "desk:write:side-w",
  tool: "desk:write:tool",
  folded: "desk:write:folded",
  railOpen: "desk:write:rail-open",
  beside: "desk:write:beside",
  notesOpen: "desk:write:notes-open",
  flash: "desk:write:flash",
  /** The suggestions margin folded away, the writing taking its space. */
  marginFolded: "desk:write:margin-folded",
} as const;

export type Tool = "files" | "ask" | "history";
export const TOOLS: readonly Tool[] = ["files", "ask", "history"];

export function sideMax(windowWidth: number): number {
  return Math.max(SIDE_MIN, Math.floor(windowWidth * SIDE_MAX_SHARE));
}

/** A width the panel can actually have in a window this wide. */
export function clampSide(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) return Math.min(SIDE_DEFAULT, sideMax(windowWidth));
  return Math.round(Math.min(Math.max(width, SIDE_MIN), sideMax(windowWidth)));
}

/** A remembered width, or the default when nothing (or nonsense) is stored. */
export function parseWidth(stored: string | null): number {
  const n = stored === null ? NaN : Number(stored);
  return Number.isFinite(n) && n > 0 ? n : SIDE_DEFAULT;
}

export function parseTool(stored: string | null): Tool {
  return (TOOLS as readonly string[]).includes(stored ?? "") ? (stored as Tool) : "files";
}

/** The width after a key press on the resize grip, or null for keys it ignores. */
export function nudgeSide(width: number, key: string, shift: boolean, windowWidth: number): number | null {
  const step = shift ? SIDE_BIG_STEP : SIDE_STEP;
  if (key === "ArrowRight") return clampSide(width + step, windowWidth);
  if (key === "ArrowLeft") return clampSide(width - step, windowWidth);
  if (key === "Home") return SIDE_MIN;
  if (key === "End") return sideMax(windowWidth);
  if (key === "Enter") return clampSide(SIDE_DEFAULT, windowWidth);
  return null;
}
