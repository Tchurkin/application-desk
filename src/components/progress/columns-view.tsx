"use client";
import { useRef, useState } from "react";
import { countLabel, countPhrase, pieceDue, type Lane } from "@/lib/progress/lanes";
import { stageLabel, STAGES } from "@/lib/progress/stages";
import { DueTag } from "./due-cell";
import type { LaneContext } from "./lanes-view";
import { StageSlider } from "./stage-slider";

/*
 * The classic scrum board: five columns, one card per piece. Each column lists its cards in
 * the lanes' urgency order. Cards move the same way chips do: drag across the columns, or
 * focus one and use the arrow keys.
 */

export function ColumnsView({ lanes, ctx }: { lanes: Lane[]; ctx: LaneContext }) {
  const track = useRef<HTMLDivElement>(null);
  const [zone, setZone] = useState<number | null>(null);
  const cards = lanes.flatMap((lane) => lane.pieces.map((piece) => ({ piece, lane })));

  return (
    // Five columns need room: on a phone they scroll sideways inside the board, not the page.
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div ref={track} className="grid min-w-[52rem] grid-cols-5 gap-2">
        {STAGES.map((stage, i) => {
          const list = cards.filter((c) => c.piece.status === stage);
          const headingId = `col-${stage}`;
          return (
            <section
              key={stage}
              aria-labelledby={headingId}
              data-column={stage}
              className={`flex min-h-48 flex-col rounded-lg border border-dashed p-2 transition-colors ${
                zone === i ? "border-accent bg-accent-soft" : "border-line"
              }`}
            >
              <h2 id={headingId} className="mb-2 flex items-baseline justify-between px-0.5 text-xs font-medium tracking-wide text-muted uppercase">
                {stageLabel(stage)}
                <span className="tabular-nums">{list.length}</span>
              </h2>
              {list.length === 0 ? (
                <p className="px-0.5 text-xs text-muted">Nothing here.</p>
              ) : (
                <ul aria-label={stageLabel(stage)} className="flex flex-col gap-2">
                  {list.map(({ piece, lane }) => (
                    <li key={piece.id}>
                      <StageSlider
                        stage={piece.status}
                        href={`${ctx.base}/piece/${piece.id}`}
                        name={`${piece.title}, ${lane.name}`}
                        tooltip={`${piece.title}: ${countPhrase(piece)}${ctx.canWrite ? " · drag to another column" : ""}`}
                        movable={ctx.canWrite}
                        track={track}
                        focusToken={`c:${piece.id}`}
                        onMove={(to, token) => ctx.onMove(piece, to, token)}
                        onZone={setZone}
                        className={`relative block rounded-md border border-line bg-panel px-2.5 py-2 text-sm hover:border-muted ${
                          piece.status === "submitted" ? "opacity-75" : ""
                        }`}
                        dragClassName="z-10 shadow-lg"
                        dragStyle={(d) => ({ transform: `translate(${d.dx}px, ${d.dy}px)` })}
                      >
                        <span className="line-clamp-2 font-medium">{piece.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-muted">{lane.name}</span>
                        <span className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs">
                          <span className="text-muted tabular-nums">{countLabel(piece)}</span>
                          <DueTag date={pieceDue(piece, lane.college)} today={ctx.today} />
                        </span>
                      </StageSlider>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
