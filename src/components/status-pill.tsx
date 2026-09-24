import { labelOf, PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";

const TONE: Record<PieceStatus, string> = {
  not_started: "bg-bg text-muted border-line",
  drafting: "bg-warn-soft text-warn border-transparent",
  needs_review: "bg-warn-soft text-warn border-warn",
  final: "bg-accent-soft text-accent border-transparent",
  submitted: "bg-accent text-accent-ink border-transparent",
};

export function StatusPill({ status }: { status: PieceStatus }) {
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${TONE[status]}`}>
      {labelOf(PIECE_STATUSES, status)}
    </span>
  );
}
