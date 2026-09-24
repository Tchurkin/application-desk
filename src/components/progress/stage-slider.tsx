"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import type { PieceStatus } from "@/lib/domain/colleges";
import { LAST_STAGE, stageForKey, stageIndex, stageLabel } from "@/lib/progress/stages";
import { useStageDrag, type DragState } from "./use-stage-drag";

/*
 * A piece on the board: a chip on a lane or a card in a column. For someone who can write it
 * is a slider over the five stages (drag it, or focus it and use the arrow keys; Home and End
 * jump to the ends) that opens the piece on click or Enter. For a read-only viewer it is a
 * plain link.
 */

export type MoveHandler = (to: PieceStatus, focusToken: string | null) => void;

export function StageSlider({
  stage,
  href,
  name,
  tooltip,
  movable,
  track,
  focusToken,
  onMove,
  onZone,
  className,
  dragClassName,
  dragStyle,
  style,
  children,
}: {
  stage: PieceStatus;
  href: string;
  /** Accessible name: the piece's title, and whatever tells it apart. */
  name: string;
  tooltip: string;
  movable: boolean;
  track: RefObject<HTMLElement | null>;
  /** Lets the board put focus back on this piece if moving it re-creates the element. */
  focusToken: string;
  onMove: MoveHandler;
  onZone: (zone: number | null) => void;
  className: string;
  dragClassName: string;
  dragStyle: (drag: DragState) => CSSProperties;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const router = useRouter();
  const { drag, handlers, clickWasDrag } = useStageDrag({
    track,
    stage,
    enabled: movable,
    onDrop: (to) => onMove(to, null),
    onZone,
  });

  if (!movable) {
    return (
      <Link href={href} title={tooltip} aria-label={name} data-focus={focusToken} className={className} style={style}>
        {children}
      </Link>
    );
  }

  const open = (e: MouseEvent | KeyboardEvent) => {
    // Ctrl/Cmd/Shift-click opens a new tab, as it would on a link.
    if ("button" in e && (e.metaKey || e.ctrlKey || e.shiftKey)) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      open(e);
      return;
    }
    const to = stageForKey(stage, e.key);
    if (to === null) return;
    e.preventDefault(); // at either end too, so the arrow doesn't scroll the page
    if (to !== stage) onMove(to, focusToken);
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={name}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={LAST_STAGE}
      aria-valuenow={stageIndex(stage)}
      aria-valuetext={stageLabel(stage)}
      title={tooltip}
      data-focus={focusToken}
      data-stage={stage}
      className={`${className} cursor-grab touch-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        drag ? `cursor-grabbing ${dragClassName}` : ""
      }`}
      style={drag ? { ...style, ...dragStyle(drag) } : style}
      onClick={(e) => {
        if (!clickWasDrag()) open(e);
      }}
      onKeyDown={onKeyDown}
      {...handlers}
    >
      {children}
    </div>
  );
}
