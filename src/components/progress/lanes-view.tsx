"use client";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import type { PieceStatus } from "@/lib/domain/colleges";
import {
  countLabel,
  countPhrase,
  nextPiece,
  pieceDue,
  stageGroups,
  stageSummary,
  type Lane,
  type ProgressPiece,
} from "@/lib/progress/lanes";
import { stageCenter, stageLabel, STAGES } from "@/lib/progress/stages";
import { DueCell } from "./due-cell";
import { StageSlider } from "./stage-slider";
import { StageTrack } from "./stage-track";
import { BAR_TONE, CHIP_TONE } from "./tones";

/*
 * The lanes view: one row per college, most urgent first, where a piece's position along the
 * row is its stage. Folding a college out shows one row per piece, each with its word count.
 */

export type BoardMove = (piece: ProgressPiece, to: PieceStatus, focusToken: string | null) => void;

export interface LaneContext {
  today: string;
  base: string;
  canWrite: boolean;
  /** Link college names to their details page (the owner's desk has one). */
  collegeLinks: boolean;
  onMove: BoardMove;
}

/** name | due | the five stages. On a phone the stages drop to their own full-width line. */
const ROW =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 sm:grid-cols-[196px_92px_minmax(0,1fr)]";
const TRACK_CELL = "col-span-2 sm:col-span-1";
const CHIP =
  "absolute top-1/2 block max-w-[19%] -translate-x-1/2 -translate-y-1/2 truncate rounded-full border px-2 py-0.5 text-xs whitespace-nowrap transition-[left] duration-150";
const CHIP_DRAG = "z-10 scale-105 shadow-lg";
/** Follow the pointer exactly (no easing) while dragging. */
const dragLeft = (d: { x: number }) => ({ left: `${d.x}px`, transition: "none" });

const pieceHref = (base: string, id: string) => `${base}/piece/${id}`;
const chipLeft = (stage: PieceStatus) => ({ left: `${stageCenter(stage) * 100}%` });

export function LanesView({
  lanes,
  open,
  onToggle,
  ctx,
}: {
  lanes: Lane[];
  open: ReadonlySet<string>;
  onToggle: (key: string) => void;
  ctx: LaneContext;
}) {
  return (
    <div>
      <div
        aria-hidden
        className={`${ROW} sticky top-0 z-20 border border-transparent bg-bg py-2 text-[10px] font-medium tracking-wide text-muted uppercase sm:text-xs`}
      >
        <span className="hidden sm:block" />
        <span className="hidden sm:block">Due</span>
        <span className={`${TRACK_CELL} grid grid-cols-5 gap-1 text-center leading-tight`}>
          {STAGES.map((s) => (
            <span key={s}>{stageLabel(s)}</span>
          ))}
        </span>
      </div>
      <ol aria-label="Colleges by urgency" className="flex flex-col gap-2">
        {lanes.map((lane) => (
          <CollegeLane key={lane.key} lane={lane} open={open.has(lane.key)} onToggle={() => onToggle(lane.key)} ctx={ctx} />
        ))}
      </ol>
    </div>
  );
}

function CollegeLane({ lane, open, onToggle, ctx }: { lane: Lane; open: boolean; onToggle: () => void; ctx: LaneContext }) {
  const track = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<number | null>(null);
  const listId = useId();
  const collegeHref = lane.college && ctx.collegeLinks ? `${ctx.base}/college/${lane.college.id}` : null;
  const first = nextPiece(lane.pieces);
  const nameHref = first ? pieceHref(ctx.base, first.id) : collegeHref;
  const hasPieces = lane.pieces.length > 0;

  return (
    <li aria-label={lane.name} data-lane={lane.key} className={`card ${lane.submitted ? "opacity-70" : ""}`}>
      <div className={`${ROW} py-2`}>
        <div className="flex min-w-0 items-center gap-1">
          {hasPieces ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              aria-label={`Show pieces of ${lane.name}`}
              title={open ? "Fold" : "Show each piece"}
              onClick={onToggle}
              className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-bg hover:text-ink"
            >
              <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
            </button>
          ) : (
            <span aria-hidden className="size-6 shrink-0" />
          )}
          <div className="min-w-0">
            {nameHref ? (
              <Link
                href={nameHref}
                title={first ? `Open ${first.title}` : "Details"}
                className="block truncate font-medium hover:underline"
              >
                {lane.name}
              </Link>
            ) : (
              <span className="block truncate font-medium">{lane.name}</span>
            )}
            <StatusStrip pieces={lane.pieces} />
          </div>
        </div>
        <DueCell date={lane.due} today={ctx.today} empty="no date" />
        <StageTrack trackRef={track} zone={zone} label={`${lane.name} stages`} className={`${TRACK_CELL} h-10`}>
          {hasPieces ? (
            stageGroups(lane.pieces).map(({ stage, pieces }) => {
              if (pieces.length === 1) {
                const p = pieces[0];
                return (
                  <StageSlider
                    key={p.id}
                    stage={stage}
                    href={pieceHref(ctx.base, p.id)}
                    name={p.title}
                    tooltip={ctx.canWrite ? `${p.title} · drag to change stage` : p.title}
                    movable={ctx.canWrite}
                    track={track}
                    focusToken={`s:${p.id}`}
                    onMove={(to, token) => ctx.onMove(p, to, token)}
                    onZone={setZone}
                    className={`${CHIP} ${CHIP_TONE[stage]}`}
                    dragClassName={CHIP_DRAG}
                    dragStyle={dragLeft}
                    style={chipLeft(stage)}
                  >
                    {p.title}
                  </StageSlider>
                );
              }
              // Several pieces at one stage share a chip. It opens the first; which one to move
              // would be ambiguous, so they move one by one from the folded-out rows.
              const titles = pieces.map((p) => p.title).join(", ");
              return (
                <Link
                  key={`group-${stage}`}
                  href={pieceHref(ctx.base, pieces[0].id)}
                  aria-label={`${pieces.length} pieces, ${stageLabel(stage)}: ${titles}`}
                  title={ctx.canWrite ? `${titles} · show each piece to move them` : titles}
                  data-focus={pieces.map((p) => `s:${p.id}`).join(" ")}
                  className={`${CHIP} ${CHIP_TONE[stage]} hover:shadow-sm`}
                  style={chipLeft(stage)}
                >
                  {pieces.length} pieces
                </Link>
              );
            })
          ) : (
            <p className="absolute inset-0 grid place-items-center text-xs text-muted">
              <span>
                No pieces yet
                {collegeHref && (
                  <>
                    {" · "}
                    <Link href={collegeHref} className="underline hover:text-ink">
                      add one
                    </Link>
                  </>
                )}
              </span>
            </p>
          )}
        </StageTrack>
      </div>
      {open && hasPieces && (
        <ul id={listId} aria-label={`Pieces of ${lane.name}`} className="border-t border-line py-1">
          {lane.pieces.map((p) => (
            <PieceLane key={p.id} piece={p} lane={lane} ctx={ctx} />
          ))}
          {collegeHref && (
            <li className="px-3 py-1 pl-10 text-xs">
              <Link href={collegeHref} className="text-muted hover:text-ink">
                Details and new pieces →
              </Link>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function PieceLane({ piece, lane, ctx }: { piece: ProgressPiece; lane: Lane; ctx: LaneContext }) {
  const track = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<number | null>(null);
  const href = pieceHref(ctx.base, piece.id);
  return (
    <li aria-label={piece.title} data-piece={piece.id} className={`${ROW} py-1`}>
      <Link href={href} title={piece.title} className="truncate pl-7 text-sm text-muted hover:text-ink">
        {piece.title}
      </Link>
      <DueCell date={pieceDue(piece, lane.college)} today={ctx.today} />
      <StageTrack trackRef={track} zone={zone} label={`${piece.title} stages`} className={`${TRACK_CELL} h-8`}>
        <StageSlider
          stage={piece.status}
          href={href}
          name={`${piece.title}, ${countPhrase(piece)}`}
          tooltip={`${piece.title}: ${countPhrase(piece)}${ctx.canWrite ? " · drag to change stage" : ""}`}
          movable={ctx.canWrite}
          track={track}
          focusToken={`p:${piece.id}`}
          onMove={(to, token) => ctx.onMove(piece, to, token)}
          onZone={setZone}
          className={`${CHIP} tabular-nums ${CHIP_TONE[piece.status]}`}
          dragClassName={CHIP_DRAG}
          dragStyle={dragLeft}
          style={chipLeft(piece.status)}
        >
          {countLabel(piece)}
        </StageSlider>
      </StageTrack>
    </li>
  );
}

/** One small bar per piece, colored by stage: the college's progress at a glance. */
function StatusStrip({ pieces }: { pieces: ProgressPiece[] }) {
  if (!pieces.length) return null;
  return (
    <span role="img" aria-label={stageSummary(pieces)} className="mt-1 flex h-1.5 max-w-full gap-0.5">
      {pieces.map((p) => (
        <span
          key={p.id}
          title={`${p.title}: ${stageLabel(p.status)}`}
          className={`max-w-3 min-w-1 flex-1 rounded-sm ${BAR_TONE[p.status]}`}
        />
      ))}
    </span>
  );
}
