import { PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";

/*
 * A piece's stage is its position along a lane: five equal zones, left to right. Dragging and
 * the arrow keys are the two ways to move along it, and both come down to the helpers here.
 */

export const STAGES: readonly PieceStatus[] = PIECE_STATUSES.map((s) => s.id);
export const LAST_STAGE = STAGES.length - 1;

export function stageIndex(status: PieceStatus): number {
  const i = STAGES.indexOf(status);
  // An unknown value (a newer database) reads as the first stage rather than breaking the lane.
  return i < 0 ? 0 : i;
}

export function stageLabel(status: PieceStatus): string {
  return PIECE_STATUSES[stageIndex(status)].label;
}

/** The stage at `i`, clamped to the ends. */
export function stageAt(i: number): PieceStatus {
  return STAGES[Math.min(LAST_STAGE, Math.max(0, Math.trunc(i)))];
}

/** Where a chip sits along its lane, as a fraction of the width: the middle of its zone. */
export function stageCenter(status: PieceStatus): number {
  return (stageIndex(status) + 0.5) / STAGES.length;
}

/** The zone under a pointer at `x` on a lane that starts at `left` and is `width` wide. */
export function zoneFromX(x: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(LAST_STAGE, Math.max(0, Math.floor(((x - left) / width) * STAGES.length)));
}

/**
 * The stage a key moves a focused chip to (it behaves as a slider), or null when the key isn't
 * one of the chip's. At an end the arrow keys return the same stage, so callers can still
 * swallow the key instead of scrolling the page.
 */
export function stageForKey(status: PieceStatus, key: string): PieceStatus | null {
  const i = stageIndex(status);
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return stageAt(i + 1);
    case "ArrowLeft":
    case "ArrowDown":
      return stageAt(i - 1);
    case "Home":
      return STAGES[0];
    case "End":
      return STAGES[LAST_STAGE];
    default:
      return null;
  }
}
