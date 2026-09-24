"use client";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { PieceStatus } from "@/lib/domain/colleges";
import { STAGES, zoneFromX } from "@/lib/progress/stages";

/*
 * Dragging a piece along a track of five stage zones, with Pointer Events so mouse, pen and
 * touch all work (the element sets touch-action: none). The pointer is captured on press, so
 * the drag keeps going when it leaves the chip; the stage is whichever fifth of the track the
 * pointer is over when it's released. A press that barely moves is a click, and the click
 * that ends a real drag is swallowed so dragging never also opens the piece.
 */

/** Pixels the pointer must travel before a press becomes a drag. */
const THRESHOLD = 4;

export interface DragState {
  /** The pointer's position along the track, clamped to it (px from its left edge). */
  x: number;
  /** How far the pointer has moved since the press (px). */
  dx: number;
  dy: number;
  zone: number;
}

export function useStageDrag({
  track,
  stage,
  enabled,
  onDrop,
  onZone,
}: {
  /** The element whose width is split into the five stages. */
  track: RefObject<HTMLElement | null>;
  stage: PieceStatus;
  enabled: boolean;
  onDrop: (to: PieceStatus) => void;
  /** The zone under the pointer while dragging (to highlight it), null when the drag ends. */
  onZone: (zone: number | null) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const swallowClick = useRef(false);

  function measure(clientX: number) {
    const r = track.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: Math.min(r.width, Math.max(0, clientX - r.left)), zone: zoneFromX(clientX, r.left, r.width) };
  }

  function end(e: ReactPointerEvent<HTMLElement>, drop: boolean) {
    const p = press.current;
    if (!p || e.pointerId !== p.id) return;
    press.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
    onZone(null);
    if (!p.moved || !drop) return;
    // The click that follows this pointerup belongs to the drag. It fires in this same task, so
    // clear the flag afterwards in case a browser sends it elsewhere.
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    const m = measure(e.clientX);
    if (!m) return;
    const to = STAGES[m.zone];
    if (to !== stage) onDrop(to);
  }

  const handlers = enabled
    ? {
        onPointerDown(e: ReactPointerEvent<HTMLElement>) {
          if (e.button !== 0 || !e.isPrimary) return;
          press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        },
        onPointerMove(e: ReactPointerEvent<HTMLElement>) {
          const p = press.current;
          if (!p || e.pointerId !== p.id) return;
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          if (!p.moved && Math.hypot(dx, dy) < THRESHOLD) return;
          p.moved = true;
          const m = measure(e.clientX);
          if (!m) return;
          setDrag({ x: m.x, dx, dy, zone: m.zone });
          onZone(m.zone);
        },
        onPointerUp: (e: ReactPointerEvent<HTMLElement>) => end(e, true),
        onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => end(e, false),
        onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => end(e, false),
      }
    : {};

  /** True (once) when the click being handled is the end of a drag. */
  function clickWasDrag(): boolean {
    const v = swallowClick.current;
    swallowClick.current = false;
    return v;
  }

  return { drag, handlers, clickWasDrag };
}
