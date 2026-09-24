"use client";

import Collaboration from "@tiptap/extension-collaboration";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { PIECE_STATUSES, type PieceStatus } from "@/lib/domain/colleges";
import { countChars, countWords, limitState, type LimitKind } from "@/lib/domain/count";
import { supabaseBrowser } from "@/lib/supabase/client";
import { safeLocalStorage, tabClientId } from "@/lib/sync/client-id";
import { PieceSync, type SyncStatus } from "@/lib/sync/piece-sync";
import { SupabaseUpdateStore } from "@/lib/sync/supabase-store";
import { listVersions, loadVersion, saveVersion, SNAPSHOT_EVERY, type VersionRow } from "@/lib/sync/versions";
import { deletePiece } from "../../actions";

export interface PieceMeta {
  id: string;
  college_id: string | null;
  title: string;
  prompt: string;
  limit_kind: LimitKind;
  limit_value: number | null;
  status: PieceStatus;
  notes: string;
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  loading: "Opening…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Can't reach the server. Your writing is kept on this device and will be sent when it reconnects.",
  gone: "This piece was deleted.",
};

function textOf(editor: Editor): string {
  return editor.getText({ blockSeparator: "\n" });
}

/** Debounced writes of a piece's own fields (never the essay text). */
function useMetaSaver(pieceId: string) {
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length) await supabaseBrowser().from("pieces").update(patch).eq("id", pieceId);
  }, [pieceId]);
  const save = useCallback(
    (patch: Record<string, unknown>, delay = 600) => {
      Object.assign(pending.current, patch);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [flush],
  );
  useEffect(() => () => void flush(), [flush]);
  return useMemo(() => ({ save, flush }), [save, flush]);
}

export function PieceEditor({
  piece,
  userId,
  author,
  collegeName,
}: {
  piece: PieceMeta;
  userId: string;
  author: string;
  collegeName: string | null;
}) {
  const supabase = supabaseBrowser();
  const [sync, setSync] = useState<PieceSync | null>(null);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState(piece.title);
  const [prompt, setPrompt] = useState(piece.prompt);
  const [notes, setNotes] = useState(piece.notes);
  const [pieceStatus, setPieceStatus] = useState<PieceStatus>(piece.status);
  const [limitKind, setLimitKind] = useState<LimitKind>(piece.limit_kind);
  const [limitValue, setLimitValue] = useState<number | null>(piece.limit_value);
  const [text, setText] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const meta = useMetaSaver(piece.id);

  // Load the document and keep it saved.
  useEffect(() => {
    let alive = true;
    const s = new PieceSync(piece.id, new SupabaseUpdateStore(supabase), safeLocalStorage(), tabClientId(), {
      onStatus: (st) => alive && setStatus(st),
    });
    s.start()
      .then((r) => alive && r === "ok" && setSync(s))
      .catch((e: Error) => alive && setLoadError(e.message));
    const flushSoon = () => void s.flush();
    const onHide = () => document.visibilityState === "hidden" && flushSoon();
    window.addEventListener("pagehide", flushSoon);
    document.addEventListener("visibilitychange", onHide);
    // Reopen this piece after a reload or a later visit.
    // (Supabase queries are lazy: .then() is what sends them.)
    supabase.from("profiles").update({ last_piece_id: piece.id }).eq("id", userId).then(() => {});
    return () => {
      alive = false;
      window.removeEventListener("pagehide", flushSoon);
      document.removeEventListener("visibilitychange", onHide);
      void s.flush().finally(() => s.stop());
    };
  }, [piece.id, supabase, userId]);

  // The first words move a piece out of "Not started".
  const onText = useCallback(
    (t: string) => {
      setText(t);
      if (t.trim()) {
        setPieceStatus((st) => {
          if (st !== "not_started") return st;
          meta.save({ status: "drafting" }, 0);
          return "drafting";
        });
      }
    },
    [meta],
  );

  const limit = limitState(text, limitKind, limitValue);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <section className="min-w-0">
        <input
          className="w-full bg-transparent font-serif text-3xl outline-none"
          value={title}
          aria-label="Piece title"
          onChange={(e) => {
            setTitle(e.target.value);
            meta.save({ title: e.target.value.slice(0, 300) || "Untitled" });
          }}
        />
        {collegeName && <p className="text-sm text-muted">{collegeName}</p>}
        <details className="mt-3" open={!!prompt}>
          <summary className="cursor-pointer text-sm text-muted">Prompt</summary>
          <textarea
            className="field mt-2"
            rows={3}
            value={prompt}
            aria-label="Prompt"
            placeholder="Paste the question exactly as the college asks it."
            onChange={(e) => {
              setPrompt(e.target.value);
              meta.save({ prompt: e.target.value });
            }}
          />
        </details>

        <div className="card essay mt-4 px-5 py-4 sm:px-8 sm:py-6">
          {loadError ? (
            <p className="text-danger">Couldn&apos;t open this piece: {loadError}</p>
          ) : status === "gone" ? (
            <p className="text-danger">{STATUS_TEXT.gone}</p>
          ) : sync ? (
            <EssayEditor sync={sync} pieceId={piece.id} author={author} onText={onText} onEditor={setEditor} />
          ) : (
            <p className="text-muted">{STATUS_TEXT.loading}</p>
          )}
        </div>

        <div className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg py-2 text-sm">
          <span data-testid="count" className={limit.over ? "font-medium text-danger" : ""}>
            {limit.limit
              ? `${limit.used} / ${limit.limit} ${limitKind === "chars" ? "characters" : "words"}`
              : `${countWords(text)} words · ${countChars(text)} characters`}
            {limit.over && ` (${limit.used - limit.limit!} over)`}
          </span>
          <span data-testid="sync-status" className={status === "offline" ? "text-warn" : "text-muted"}>
            {STATUS_TEXT[status]}
          </span>
        </div>
        {limit.fraction !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className={`h-full ${limit.over ? "bg-danger" : "bg-accent"}`} style={{ width: `${limit.fraction * 100}%` }} />
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-5">
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select
            id="status"
            className="field"
            value={pieceStatus}
            onChange={(e) => {
              const v = e.target.value as PieceStatus;
              setPieceStatus(v);
              meta.save({ status: v }, 0);
            }}
          >
            {PIECE_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="limit_value">Limit</label>
            <input
              id="limit_value"
              className="field"
              type="number"
              min={1}
              value={limitValue ?? ""}
              disabled={limitKind === "none"}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                const v = Number.isFinite(n) && n > 0 ? n : null;
                setLimitValue(v);
                meta.save({ limit_value: v });
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="limit_kind">Counted in</label>
            <select
              id="limit_kind"
              className="field"
              value={limitKind}
              onChange={(e) => {
                const v = e.target.value as LimitKind;
                setLimitKind(v);
                meta.save({ limit_kind: v }, 0);
              }}
            >
              <option value="words">Words</option>
              <option value="chars">Characters</option>
              <option value="none">No limit</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            className="field"
            rows={6}
            value={notes}
            placeholder="Ideas, reminders, feedback. Kept apart from the essay and never counted."
            onChange={(e) => {
              setNotes(e.target.value);
              meta.save({ notes: e.target.value });
            }}
          />
        </div>
        <History pieceId={piece.id} editor={editor} />
        <div>
          <ConfirmButton
            label="Delete piece"
            question="Delete this piece, its history and its notes?"
            onConfirm={async () => {
              sync?.discard();
              await deletePiece(piece.id);
            }}
          />
        </div>
      </aside>
    </div>
  );
}

/** The essay itself: TipTap bound to the piece's Yjs document. */
function EssayEditor({
  sync,
  pieceId,
  author,
  onText,
  onEditor,
}: {
  sync: PieceSync;
  pieceId: string;
  author: string;
  onText: (t: string) => void;
  onEditor: (e: Editor | null) => void;
}) {
  const supabase = supabaseBrowser();
  const lastSnapshot = useRef<{ at: number; text: string | null }>({ at: 0, text: null });

  const extensions = useMemo(
    () => [
      StarterKit.configure({ undoRedo: false, heading: false, codeBlock: false, code: false, horizontalRule: false }),
      Collaboration.configure({ document: sync.doc, field: "default" }),
      Placeholder.configure({ placeholder: "Start writing…" }),
    ],
    [sync],
  );

  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      editorProps: { attributes: { "aria-label": "Essay", "data-testid": "essay" } },
      onCreate: ({ editor }) => {
        const t = textOf(editor);
        onText(t);
        lastSnapshot.current = { at: Date.now(), text: t };
      },
      onUpdate: ({ editor }) => onText(textOf(editor)),
    },
    [extensions],
  );

  useEffect(() => {
    onEditor(editor);
    return () => onEditor(null);
  }, [editor, onEditor]);

  // After each save: refresh the board's derived fields, and take a version now and then.
  useEffect(() => {
    if (!editor) return;
    let derivedTimer: ReturnType<typeof setTimeout> | null = null;
    let firstChecked = false;

    const saveDerived = () => {
      derivedTimer = null;
      const t = textOf(editor);
      supabase
        .from("pieces")
        .update({ plain_text: t, word_count: countWords(t), char_count: countChars(t) })
        .eq("id", pieceId)
        .then(() => {});
    };
    const snapshot = (force: boolean) => {
      const t = textOf(editor);
      const last = lastSnapshot.current;
      if (t === last.text) return;
      if (!force && Date.now() - last.at < SNAPSHOT_EVERY) return;
      lastSnapshot.current = { at: Date.now(), text: t };
      void saveVersion(supabase, pieceId, author, editor.getJSON(), t);
    };
    const onSaved = async () => {
      if (derivedTimer) clearTimeout(derivedTimer);
      derivedTimer = setTimeout(saveDerived, 800);
      if (!firstChecked) {
        // A piece's first save records a version straight away, so history reaches the start.
        firstChecked = true;
        const { count } = await supabase
          .from("piece_versions")
          .select("id", { count: "exact", head: true })
          .eq("piece_id", pieceId);
        if (!count) {
          lastSnapshot.current.text = null;
          return snapshot(true);
        }
      }
      snapshot(false);
    };
    const unsubscribe = sync.addSavedListener(() => void onSaved());
    return () => {
      unsubscribe();
      if (derivedTimer) {
        clearTimeout(derivedTimer);
        saveDerived();
      }
      if (!editor.isDestroyed) snapshot(true);
    };
  }, [editor, sync, supabase, pieceId, author]);

  return <EditorContent editor={editor} />;
}

function History({ pieceId, editor }: { pieceId: string; editor: Editor | null }) {
  const supabase = supabaseBrowser();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; text: string; content: JSONContent } | null>(null);

  useEffect(() => {
    if (!open) return;
    listVersions(supabase, pieceId).then(setVersions, () => setVersions([]));
  }, [open, supabase, pieceId]);

  return (
    <div>
      <button type="button" className="label cursor-pointer" onClick={() => setOpen(!open)} aria-expanded={open}>
        History {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {versions === null ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted">No saved versions yet.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto rounded-md border border-line bg-panel text-sm" aria-label="Saved versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className={`flex w-full justify-between gap-2 px-2 py-1 text-left hover:bg-bg ${preview?.id === v.id ? "bg-accent-soft" : ""}`}
                    onClick={async () => {
                      const full = await loadVersion(supabase, v.id);
                      setPreview({ id: v.id, text: full.plain_text, content: full.content as JSONContent });
                    }}
                  >
                    <span>{new Date(v.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span>
                    <span className="text-muted">{v.words} words</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {preview && (
            <div className="rounded-md border border-line bg-panel p-3">
              <p className="mb-2 max-h-60 overflow-y-auto font-serif text-sm whitespace-pre-wrap" data-testid="version-preview">
                {preview.text || <em className="text-muted">(empty)</em>}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!editor}
                  onClick={() => {
                    // Restoring is an ordinary edit: today's text stays in history, and the change syncs.
                    editor?.commands.setContent(preview.content);
                    setPreview(null);
                    setOpen(false);
                  }}
                >
                  Restore this version
                </button>
                <button type="button" className="btn" onClick={() => setPreview(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
