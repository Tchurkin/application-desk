"use client";

import type { Editor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { AskPanel } from "@/components/ask/ask-panel";
import { CollegeRail } from "@/components/write/college-rail";
import { ConfirmDialog } from "@/components/write/confirm-dialog";
import { AskIcon, FilesIcon, HistoryIcon } from "@/components/write/icons";
import { PieceTabs } from "@/components/write/piece-tabs";
import { Workspace, type ToolDef } from "@/components/write/workspace";
import type { PieceStatus } from "@/lib/domain/colleges";
import type { RailGroup, RailPiece } from "@/lib/write/rail";
import { deletePiece } from "../../actions";
import { makeVersion } from "./actions";

const TOOLS: ToolDef[] = [
  { id: "files", label: "Files", hint: "Colleges and pieces", icon: <FilesIcon /> },
  { id: "ask", label: "Ask", hint: "Ask Claude or ChatGPT about this piece", icon: <AskIcon /> },
  { id: "history", label: "History", hint: "Earlier versions of this piece", icon: <HistoryIcon /> },
];

const pieceHref = (id: string) => `/desk/piece/${id}`;
const collegeHref = (id: string) => `/desk/college/${id}`;

/**
 * The owner's Write page around the editor: the tool strip and side panel (the college rail,
 * Ask, History), and this college's pieces as tabs.
 */
export function WriteWorkspace({
  workspace,
  pieceId,
  deskId,
  title,
  countNow,
  status,
  editor,
  history,
  onDeleteCurrent,
  children,
}: {
  workspace: { groups: RailGroup[]; tabs: RailPiece[] };
  pieceId: string;
  deskId: string;
  title: string;
  countNow: string;
  status: PieceStatus;
  editor: Editor | null;
  history: ReactNode;
  onDeleteCurrent: () => void;
  children: ReactNode;
}) {
  const [deleting, setDeleting] = useState<RailPiece | null>(null);
  const group = workspace.groups.find((g) => g.pieces.some((p) => p.id === pieceId));

  return (
    <Workspace
      tools={TOOLS}
      title={(t) => (t === "files" ? "Colleges" : t === "ask" ? `Asking about ${title}` : "History")}
      renderPanel={(t) =>
        t === "files" ? (
          <CollegeRail
            groups={workspace.groups}
            currentId={pieceId}
            pieceHref={pieceHref}
            collegeHref={collegeHref}
            live={{ count: countNow, status }}
          />
        ) : t === "ask" ? (
          <div className="p-3">
            <AskPanel
              deskId={deskId}
              pieceId={pieceId}
              pieceTitle={title}
              getSelection={() => {
                if (!editor) return "";
                const { from, to } = editor.state.selection;
                return editor.state.doc.textBetween(from, to, "\n");
              }}
            />
          </div>
        ) : (
          history
        )
      }
    >
      {workspace.tabs.length > 0 && (
        <div className="px-4 pt-2">
          <PieceTabs
            college={group?.name ?? ""}
            collegeId={group?.college?.id ?? null}
            pieces={workspace.tabs}
            currentId={pieceId}
            currentCount={countNow}
            besideId={null}
            pieceHref={pieceHref}
            owner
            onDelete={setDeleting}
          />
        </div>
      )}
      {children}
      {deleting && (
        <ConfirmDialog
          question={`Delete "${deleting.title}"?`}
          detail="Its text, history, notes and suggestions go with it. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (deleting.id === pieceId) onDeleteCurrent();
            await deletePiece(deleting.id);
          }}
        />
      )}
    </Workspace>
  );
}

/** Start a version of this piece: a copy of its text as a new piece, shown beside it as a tab. */
export function MakeVersion({ pieceId }: { pieceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await makeVersion(pieceId);
            if (r.ok) router.push(`/desk/piece/${r.id}`);
            else setError(r.error);
          })
        }
      >
        {pending ? "Making a version…" : "Make a version"}
      </button>
      <p className="mt-1 text-xs text-muted">A copy of this text as a new tab, to try another direction without losing this one.</p>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
