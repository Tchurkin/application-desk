"use client";

import { Extension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import Placeholder from "@tiptap/extension-placeholder";
import { UndoCaret } from "@/lib/editor/undo-caret";
import { EditorContent, useEditor, type Editor, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FormatToolbar } from "@/components/write/format-toolbar";
import { countLabel, type RailGroup, type RailPiece } from "@/lib/write/rail";
import { MakeVersion, WriteWorkspace } from "./write-workspace";
import { ConfirmButton } from "@/components/confirm-button";
import { PIECE_STATUSES, labelOf, type PieceStatus } from "@/lib/domain/colleges";
import { countChars, countWords, limitState, type LimitKind } from "@/lib/domain/count";
import { acceptInto, resolveSuggestion, suggestKey, suggestPlugin, type SuggestMode } from "@/lib/suggest/plugin";
import { SuggestionStore, type Suggestion } from "@/lib/suggest/store";
import { SupabaseSuggestionBackend } from "@/lib/suggest/supabase-backend";
import { supabaseBrowser } from "@/lib/supabase/client";
import { safeLocalStorage, tabClientId } from "@/lib/sync/client-id";
import { PieceSync, type SyncStatus } from "@/lib/sync/piece-sync";
import { colorFor, PieceChannel, type Person } from "@/lib/sync/realtime";
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

export type Role = "owner" | "suggest" | "view";

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

interface Live {
  sync: PieceSync;
  store: SuggestionStore;
  channel: PieceChannel;
}

export function PieceEditor({
  piece,
  userId,
  author,
  collegeName,
  role = "owner",
  aiPolicy = "allowed",
  research = "",
  deskId,
  workspace,
}: {
  deskId?: string;
  /** The owner's Write workspace: the college rail and this college's pieces as tabs. */
  workspace?: { groups: RailGroup[]; tabs: RailPiece[] };
  piece: PieceMeta;
  userId: string;
  author: string;
  collegeName: string | null;
  role?: Role;
  aiPolicy?: "allowed" | "no_drafting";
  research?: string;
}) {
  const supabase = supabaseBrowser();
  const owner = role === "owner";
  const me = useMemo(() => ({ id: userId, name: author }), [userId, author]);
  const [live, setLive] = useState<Live | null>(null);
  const [status, setStatus] = useState<SyncStatus>("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [title, setTitle] = useState(piece.title);
  const [prompt, setPrompt] = useState(piece.prompt);
  const [notes, setNotes] = useState(piece.notes);
  const [pieceStatus, setPieceStatus] = useState<PieceStatus>(piece.status);
  const [limitKind, setLimitKind] = useState<LimitKind>(piece.limit_kind);
  const [limitValue, setLimitValue] = useState<number | null>(piece.limit_value);
  const [text, setText] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const meta = useMetaSaver(piece.id);
  // Editing or Suggesting. The student starts in Editing, people they share with in Suggesting;
  // either can switch, and the choice is remembered per browser. Read-only links only read.
  const canWrite = role !== "view";
  const [editMode, setEditMode] = useState<EditMode>(owner ? "editing" : "suggesting");
  const editorMode: SuggestMode = !canWrite ? "view" : editMode === "editing" ? "owner" : "suggest";
  const chooseMode = (m: EditMode) => {
    setEditMode(m);
    writeMode(role, m);
  };

  // Load the document and its suggestions, keep them saved, and follow everyone else live.
  useEffect(() => {
    let alive = true;
    const clientId = tabClientId();
    const storage = safeLocalStorage();
    const sync = new PieceSync(piece.id, new SupabaseUpdateStore(supabase), storage, clientId, {
      readOnly: role === "view",
      onStatus: (st) => alive && setStatus(st),
    });
    const store = new SuggestionStore(piece.id, new SupabaseSuggestionBackend(supabase), storage, clientId);
    const person: Person = { name: me.name, color: colorFor(me.id), role };
    const channel = new PieceChannel(supabase, piece.id, sync.doc, person, {
      onUpdateRow: (row) => sync.applyRemoteRow(row),
      onSuggestion: (row) => store.applyRemote(row),
      onSuggestionDeleted: (id) => store.applyRemoteDelete(id),
      onReconnect: () => {
        void sync.catchUp();
        void store.reload();
      },
      onPeople: (p) => alive && setPeople(p),
    });
    // Suggestions failing to load must never stop the essay from opening.
    Promise.all([sync.start(), store.start().catch(() => undefined)])
      .then(([r]) => {
        if (!alive || r !== "ok") return;
        channel.start();
        const saved = readMode(role);
        if (saved) setEditMode(saved);
        setLive({ sync, store, channel });
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    const flushSoon = () => {
      void sync.flush();
      void store.flush();
    };
    const onHide = () => document.visibilityState === "hidden" && flushSoon();
    window.addEventListener("pagehide", flushSoon);
    document.addEventListener("visibilitychange", onHide);
    // Reopen this piece after a reload or a later visit. (Supabase queries are lazy: .then() sends them.)
    if (role === "owner") supabase.from("profiles").update({ last_piece_id: piece.id }).eq("id", me.id).then(() => {});
    return () => {
      alive = false;
      window.removeEventListener("pagehide", flushSoon);
      document.removeEventListener("visibilitychange", onHide);
      channel.stop();
      void Promise.all([sync.flush(), store.flush()]).finally(() => {
        sync.stop();
        store.stop();
      });
    };
  }, [piece.id, supabase, me, role]);

  // The first words move a piece out of "Not started".
  const onText = useCallback(
    (t: string) => {
      setText(t);
      if (owner && t.trim()) {
        setPieceStatus((st) => {
          if (st !== "not_started") return st;
          meta.save({ status: "drafting" }, 0);
          return "drafting";
        });
      }
    },
    [meta, owner],
  );

  const limit = limitState(text, limitKind, limitValue);

  const body = (
    <div className={`grid gap-6 lg:grid-cols-[1fr_20rem] ${workspace ? "p-4" : ""}`}>
      <section className="min-w-0">
        {owner ? (
          <input
            className="w-full bg-transparent font-serif text-3xl outline-none"
            value={title}
            aria-label="Piece title"
            onChange={(e) => {
              setTitle(e.target.value);
              meta.save({ title: e.target.value.slice(0, 300) || "Untitled" });
            }}
          />
        ) : (
          <h1 className="font-serif text-3xl">{title}</h1>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          {collegeName && <span>{collegeName}</span>}
          {people.length > 0 && (
            <span className="flex flex-wrap gap-1" aria-label="Also here">
              {people.map((p, i) => (
                <span key={i} className="rounded-full px-2 py-0.5 text-xs text-white" style={{ background: p.color }}>
                  {p.name}
                </span>
              ))}
            </span>
          )}
        </div>
        {owner ? (
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
        ) : (
          prompt && <p className="mt-3 rounded-md border border-line bg-panel px-3 py-2 text-sm">{prompt}</p>
        )}

        {canWrite && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div role="radiogroup" aria-label="Mode" className="inline-flex rounded-md border border-line bg-panel p-0.5 text-sm">
              {(["editing", "suggesting"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={editMode === m}
                  onClick={() => chooseMode(m)}
                  className={`rounded px-3 py-1 ${editMode === m ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"}`}
                >
                  {m === "editing" ? "Editing" : "Suggesting"}
                </button>
              ))}
            </div>
            {editMode === "suggesting" && (
              <p className="text-sm text-muted">
                Your changes show as suggestions{owner ? " you can accept or decline" : " for the writer to accept or decline"}. Ctrl+Z
                undoes your last suggestions.
              </p>
            )}
          </div>
        )}
        {role === "view" && <p className="mt-3 text-sm text-muted">You can read this piece. You can&apos;t change it.</p>}

        {editor && live && canWrite && (
          <div className="mt-3">
            <FormatToolbar editor={editor} mode={editorMode === "suggest" ? "suggest" : "owner"} store={live.store} />
          </div>
        )}
        <div className="card essay mt-4 px-5 py-4 sm:px-8 sm:py-6">
          {loadError ? (
            <p className="text-danger">Couldn&apos;t open this piece: {loadError}</p>
          ) : status === "gone" ? (
            <p className="text-danger">{STATUS_TEXT.gone}</p>
          ) : live ? (
            <EssayEditor
              key={editorMode}
              live={live}
              pieceId={piece.id}
              me={me}
              mode={editorMode}
              isDeskOwner={owner}
              onText={onText}
              onEditor={setEditor}
            />
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
            {editorMode === "owner" ? STATUS_TEXT[status] : status === "loading" ? STATUS_TEXT.loading : "Live"}
          </span>
        </div>
        {limit.fraction !== null && (
          <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className={`h-full ${limit.over ? "bg-danger" : "bg-accent"}`} style={{ width: `${limit.fraction * 100}%` }} />
          </div>
        )}
      </section>

      <aside className="flex flex-col gap-5">
        {live && editor && <SuggestionsPanel live={live} editor={editor} role={role} me={me.id} />}
        {owner ? (
          <>
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
                placeholder="Ideas, reminders, feedback. Kept apart from the essay and never counted. People you share with can read them."
                onChange={(e) => {
                  setNotes(e.target.value);
                  meta.save({ notes: e.target.value });
                }}
              />
            </div>
          </>
        ) : (
          <div className="text-sm">
            <p className="label">Status</p>
            <p>{labelOf(PIECE_STATUSES, pieceStatus)}</p>
            {notes && (
              <>
                <p className="label mt-4">Notes</p>
                <p className="whitespace-pre-wrap">{notes}</p>
              </>
            )}
          </div>
        )}
        {owner && (
          <ChatbotCopy
            build={() =>
              chatbotPrompt({
                title,
                collegeName,
                aiPolicy,
                prompt,
                limitKind,
                limitValue,
                text,
                notes,
                research,
              })
            }
          />
        )}
        {owner && workspace && <MakeVersion pieceId={piece.id} />}
        {!workspace && <History pieceId={piece.id} editor={owner ? editor : null} />}
        {owner && (
          <div>
            <ConfirmButton
              label="Delete piece"
              question="Delete this piece, its history, notes and suggestions?"
              onConfirm={async () => {
                live?.sync.discard();
                await deletePiece(piece.id);
              }}
            />
          </div>
        )}
      </aside>
    </div>
  );
  if (!workspace) return body;
  return (
    <WriteWorkspace
      workspace={workspace}
      pieceId={piece.id}
      deskId={deskId ?? ""}
      title={title}
      countNow={countLabel({ words: countWords(text), chars: countChars(text), kind: limitKind, limit: limitValue })}
      status={pieceStatus}
      editor={editor}
      history={<History pieceId={piece.id} editor={editor} inPanel />}
      onDeleteCurrent={() => live?.sync.discard()}
    >
      {body}
    </WriteWorkspace>
  );
}

/** The essay itself: TipTap bound to the piece's Yjs document. */
function EssayEditor({
  live,
  pieceId,
  me,
  mode,
  isDeskOwner = false,
  onText,
  onEditor,
}: {
  live: Live;
  pieceId: string;
  me: { id: string; name: string };
  mode: SuggestMode;
  /** The student (who keeps the version history); others editing only update the counts. */
  isDeskOwner?: boolean;
  onText: (t: string) => void;
  onEditor: (e: Editor | null) => void;
}) {
  const supabase = supabaseBrowser();
  const lastSnapshot = useRef<{ at: number; text: string | null }>({ at: 0, text: null });
  // The text as it was when this piece was opened.
  const opening = useRef<{ text: string; json: JSONContent } | null>(null);
  const owner = mode === "owner";

  const extensions = useMemo(() => {
    const { sync, store, channel } = live;
    const Suggestions = Extension.create({
      name: "suggestions",
      addProseMirrorPlugins: () => [suggestPlugin({ store, mode, me, pieceId })],
    });
    const user = channel.awareness.getLocalState()?.user as { name: string; color: string };
    return [
      StarterKit.configure({ undoRedo: false, heading: false, codeBlock: false, code: false, horizontalRule: false }),
      Collaboration.configure({ document: sync.doc, field: "default" }),
      CollaborationCaret.configure({ provider: { awareness: channel.awareness }, user }),
      Placeholder.configure({ placeholder: mode === "owner" ? "Start writing…" : "Nothing written yet." }),
      UndoCaret,
      Suggestions,
    ];
  }, [live, mode, me, pieceId]);

  const editor = useEditor(
    {
      extensions,
      immediatelyRender: false,
      editorProps: { attributes: { "aria-label": "Essay", "data-testid": "essay" } },
      onCreate: ({ editor }) => {
        const t = textOf(editor);
        onText(t);
        lastSnapshot.current = { at: Date.now(), text: t };
        opening.current = { text: t, json: editor.getJSON() };
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
    if (!editor || !owner) return;
    const { sync } = live;
    let derivedTimer: ReturnType<typeof setTimeout> | null = null;
    let firstChecked = false;

    const saveDerived = () => {
      derivedTimer = null;
      const t = textOf(editor);
      const stats = { plain_text: t, word_count: countWords(t), char_count: countChars(t) };
      // Anyone editing may update the counts (migration 20260930); before it, only the student could.
      supabase
        .rpc("set_piece_text_stats", { piece: pieceId, plain: t, words: stats.word_count, chars: stats.char_count })
        .then(({ error }) => {
          if (error && isDeskOwner) supabase.from("pieces").update(stats).eq("id", pieceId).then(() => {});
        });
    };
    const snapshot = (force: boolean) => {
      // The version history is the student's; their editor keeps it.
      if (!isDeskOwner) return;
      const t = textOf(editor);
      const last = lastSnapshot.current;
      if (t === last.text) return;
      if (!force && Date.now() - last.at < SNAPSHOT_EVERY) return;
      lastSnapshot.current = { at: Date.now(), text: t };
      void saveVersion(supabase, pieceId, me.name, editor.getJSON(), t);
    };
    const onSaved = async () => {
      if (derivedTimer) clearTimeout(derivedTimer);
      derivedTimer = setTimeout(saveDerived, 800);
      if (!firstChecked && isDeskOwner) {
        firstChecked = true;
        const { data } = await supabase
          .from("piece_versions")
          .select("plain_text")
          .eq("piece_id", pieceId)
          .order("at", { ascending: false })
          .limit(1);
        const newest = data?.[0]?.plain_text ?? null;
        const open = opening.current;
        // Leaving a page can't be relied on to save a version, so the text a session ends with
        // is recorded when the next session starts changing it.
        if (open && open.text.trim() && open.text !== newest) {
          await saveVersion(supabase, pieceId, me.name, open.json, open.text);
        }
        // A new piece's first save records a version straight away, so history reaches the start.
        if (newest === null && !open?.text.trim()) {
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
  }, [editor, live, supabase, pieceId, me.name, owner, isDeskOwner]);

  return <EditorContent editor={editor} />;
}

function describe(s: Suggestion): string {
  const q = (t: string | undefined) => {
    const s = t ?? "";
    return `“${s.replace(/\n/g, " ¶ ").slice(0, 80)}${s.length > 80 ? "…" : ""}”`;
  };
  if (s.kind === "insert") return `Add ${q(s.body)}`;
  if (s.kind === "delete") return `Delete ${q(s.quote)}`;
  return `Replace ${q(s.quote)} with ${q(s.body)}`;
}

function SuggestionsPanel({ live, editor, role, me }: { live: Live; editor: Editor; role: Role; me: string }) {
  const { store } = live;
  const open = useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => store.open(),
    () => store.open(),
  );
  const [undo, setUndo] = useState<{ label: string; run: () => void } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 8000);
    return () => clearTimeout(t);
  }, [undo]);

  const pick = (id: string) => editor.view.dispatch(editor.state.tr.setMeta(suggestKey, { pick: id }));

  if (!open.length && !undo) {
    return role === "owner" ? null : (
      <div>
        <p className="label">Suggestions</p>
        <p className="text-sm text-muted">None yet.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="label">Suggestions ({open.length})</p>
      {undo && (
        <p className="mb-2 flex items-center justify-between rounded-md bg-accent-soft px-2 py-1 text-sm" role="status">
          {undo.label}
          <button
            type="button"
            className="underline"
            onClick={() => {
              undo.run();
              setUndo(null);
            }}
          >
            Undo
          </button>
        </p>
      )}
      <ul className="flex flex-col gap-2" aria-label="Suggestions">
        {open.map((s) => {
          const r = resolveSuggestion(editor.state, s);
          return (
            <li key={s.id} className="rounded-md border border-line bg-panel p-2 text-sm" data-testid="suggestion">
              <button type="button" className="block w-full text-left" onClick={() => pick(s.id)}>
                <span className="block text-xs text-muted">
                  {s.author_name || "Someone"}
                  {s.source === "ai" && " · AI"}
                  {r.stale && !r.gone && " · the text changed since"}
                  {r.gone && " · its text is gone"}
                </span>
                <span className="break-words">{describe(s)}</span>
                {s.note && <span className="mt-1 block text-xs text-muted">Why: {s.note}</span>}
              </button>
              <div className="mt-2 flex gap-2">
                {role === "owner" && (
                  <>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={r.gone && s.kind !== "insert"}
                      onClick={() => {
                        if (!acceptInto(editor.view, s)) return;
                        store.resolve(s.id, "accepted");
                        setUndo({
                          label: "Accepted.",
                          run: () => {
                            editor.commands.undo();
                            store.resolve(s.id, "open");
                          },
                        });
                      }}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        store.resolve(s.id, "declined");
                        setUndo({ label: "Declined.", run: () => store.resolve(s.id, "open") });
                      }}
                    >
                      Decline
                    </button>
                  </>
                )}
                {role === "suggest" && s.author_id === me && (
                  <button type="button" className="btn" onClick={() => store.remove(s.id)}>
                    Withdraw
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function History({ pieceId, editor, inPanel = false }: { pieceId: string; editor: Editor | null; inPanel?: boolean }) {
  const supabase = supabaseBrowser();
  const [openState, setOpen] = useState(false);
  // In the side panel it is always open (the tool button opens and closes the panel).
  const open = inPanel || openState;
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; text: string; content: JSONContent } | null>(null);

  useEffect(() => {
    if (!open) return;
    listVersions(supabase, pieceId).then(setVersions, () => setVersions([]));
  }, [open, supabase, pieceId]);

  return (
    <div className={inPanel ? "p-3" : ""}>
      {!inPanel && (
        <button type="button" className="label cursor-pointer" onClick={() => setOpen(!open)} aria-expanded={open}>
          History {open ? "▾" : "▸"}
        </button>
      )}
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
                {editor && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      // Restoring is an ordinary edit: today's text stays in history, and the change syncs.
                      editor.commands.setContent(preview.content);
                      setPreview(null);
                      setOpen(false);
                    }}
                  >
                    Restore this version
                  </button>
                )}
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

/** Everything a chatbot needs to help with this piece, with the desk's rules. */
function chatbotPrompt(p: {
  title: string;
  collegeName: string | null;
  aiPolicy: "allowed" | "no_drafting";
  prompt: string;
  limitKind: LimitKind;
  limitValue: number | null;
  text: string;
  notes: string;
  research: string;
}): string {
  const limit =
    p.limitKind === "none" || !p.limitValue ? "no limit" : `${p.limitValue} ${p.limitKind === "chars" ? "characters" : "words"}`;
  return [
    "I'm a high school senior working on a college application essay. Help me as a skilled college counselor and writing partner.",
    "",
    `Piece: ${p.title}${p.collegeName ? ` for ${p.collegeName}` : ""}`,
    `Prompt: ${p.prompt || "(not entered)"}`,
    `Limit: ${limit}`,
    ...(p.aiPolicy === "no_drafting" ? [`Note: I marked ${p.collegeName ?? "this college"} as not allowing AI help with drafting.`] : []),
    "",
    "My draft:",
    p.text || "(I haven't started yet.)",
    ...(p.notes ? ["", "My notes:", p.notes] : []),
    ...(p.research ? ["", `My research on ${p.collegeName}:`, p.research] : []),
    "",
    "What I'd like: ",
  ].join("\n");
}

function ChatbotCopy({ build }: { build: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="label">Ask a chatbot</p>
      <button
        type="button"
        className="btn w-full"
        onClick={async () => {
          await navigator.clipboard.writeText(build());
          setCopied(true);
          setTimeout(() => setCopied(false), 4000);
        }}
      >
        {copied ? "Copied. Paste it into a chat." : "Copy this piece for a chatbot"}
      </button>
      <p className="mt-1 text-xs text-muted">
        Copies the prompt, your draft, notes and research, for{" "}
        <a className="underline" href="https://claude.ai/new" target="_blank" rel="noreferrer">Claude</a> or{" "}
        <a className="underline" href="https://chatgpt.com/" target="_blank" rel="noreferrer">ChatGPT</a>. To have edits arrive here
        as suggestions, connect one in Settings.
      </p>
    </div>
  );
}


type EditMode = "editing" | "suggesting";
const modeKey = (role: Role) => `desk:mode:${role}`;

/** The Editing/Suggesting choice this browser made for this role, if any. */
function readMode(role: Role): EditMode | null {
  try {
    const v = localStorage.getItem(modeKey(role));
    return v === "editing" || v === "suggesting" ? v : null;
  } catch {
    return null;
  }
}

function writeMode(role: Role, m: EditMode) {
  try {
    localStorage.setItem(modeKey(role), m);
  } catch {
    // Private mode: just don't remember.
  }
}
