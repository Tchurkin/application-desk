import type { ReactNode, RefObject } from "react";
import { STAGES } from "@/lib/progress/stages";

/**
 * A lane: five dashed zones, one per stage, with the pieces placed over them. The zone under a
 * dragged piece lights up.
 */
export function StageTrack({
  trackRef,
  zone,
  label,
  className = "",
  children,
}: {
  trackRef: RefObject<HTMLDivElement | null>;
  zone: number | null;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div ref={trackRef} role="group" aria-label={label} className={`relative ${className}`}>
      <div aria-hidden className="absolute inset-0 grid grid-cols-5 gap-1">
        {STAGES.map((s, i) => (
          <div
            key={s}
            data-zone={s}
            className={`rounded-md border border-dashed transition-colors ${
              zone === i ? "border-accent bg-accent-soft" : "border-line"
            }`}
          />
        ))}
      </div>
      {children}
    </div>
  );
}
