import { parseOptions } from "@/lib/bridge/options";
import type { DeskRequest } from "@/lib/bridge/requests";
import { AnswerText } from "./answer-text";

/**
 * A request still waiting for its answer: the answer so far while the counselor writes it
 * (streamed into the request), what the counselor is doing on it, that the counselor has it, or
 * who it is waiting for. Rewrites being written show how many versions are ready, not their tags.
 */
export function PendingAnswer({ r, who, doing = null, large = false }: { r: DeskRequest; who: string; doing?: string | null; large?: boolean }) {
  if (r.answer) {
    const rewrites = r.kind === "polish" && /<option>/i.test(r.answer) ? parseOptions(r.answer) : null;
    return (
      <div className={`border-l-2 border-accent ${large ? "pl-3" : "pl-2.5"}`} aria-busy="true" data-testid="draft-answer">
        <p className="mb-1 font-mono text-[11px] tracking-wide text-muted uppercase">{who} · writing…</p>
        {rewrites ? (
          <p className="text-sm text-muted italic">
            {rewrites.options.length} version{rewrites.options.length === 1 ? "" : "s"} written so far…
          </p>
        ) : (
          <div className="typing">
            <AnswerText text={r.answer} large={large} />
          </div>
        )}
      </div>
    );
  }
  if (doing) return <p className="text-sm text-muted italic">Your counselor is {doing}…</p>;
  if (r.counselor_at) return <p className="text-sm text-muted italic">Your counselor has it…</p>;
  return <p className="text-sm text-muted italic">Waiting for {who}…</p>;
}
