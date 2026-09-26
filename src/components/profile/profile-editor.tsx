"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { LocalDay } from "@/components/local-day";
import { Modal } from "@/components/write/modal";
import { countWords } from "@/lib/domain/count";
import { docxText } from "@/lib/profile/docx";
import {
  FILE_COLS,
  FILE_MAX,
  fileKind,
  formatSize,
  imageMime,
  kindLabel,
  mergeFile,
  noteTitle,
  removeFile,
  uploadsAsNote,
  type FileKind,
  type FileRow,
} from "@/lib/profile/files";
import { mergeSection, moveSection, nextSort, removeSection, SECTION_COLS, sortSections, type SectionRow } from "@/lib/profile/sections";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * The Profile page as a folder: notes and files in a list, each opening over the page. Notes are
 * read (formatted) and edited there; files (a school's PDF form, a resume) are shown, downloaded
 * or deleted. The student writes notes and uploads files; Claude adds and rewrites notes through
 * the connector (for example during an interview) and saves the forms it fills in as new files.
 * Changes from either side show up live; a note being typed in keeps the student's words until
 * they leave it.
 */

const SAVE_MS = 600;

type Open = { note: string; fresh: boolean } | { file: string };

export function ProfileEditor({ deskId, initial, files: initialFiles }: { deskId: string; initial: SectionRow[]; files: FileRow[] | null }) {
  const supabase = supabaseBrowser();
  const [sections, setSections] = useState(() => sortSections(initial));
  // null: the database is from before files (migration 20261015).
  const filesOn = initialFiles !== null;
  const [files, setFiles] = useState<FileRow[]>(initialFiles ?? []);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  // Live: notes Claude writes during an interview, forms it fills in, and edits from another tab.
  useEffect(() => {
    const topic = `profile:${deskId}:${Math.random().toString(36).slice(2, 10)}`;
    const filter = `desk_id=eq.${deskId}`;
    let channel = supabase
      .channel(topic)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profile_sections", filter }, (p) =>
        setSections((l) => mergeSection(l, p.new as SectionRow)),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profile_sections", filter }, (p) =>
        setSections((l) => mergeSection(l, p.new as SectionRow)),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "profile_sections" }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) setSections((l) => removeSection(l, id));
      });
    if (filesOn) {
      channel = channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "profile_files", filter }, (p) =>
          setFiles((l) => mergeFile(l, p.new as FileRow)),
        )
        .on("postgres_changes", { event: "DELETE", schema: "public", table: "profile_files" }, (p) => {
          const id = (p.old as { id?: string }).id;
          if (id) setFiles((l) => removeFile(l, id));
        });
    }
    channel.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      // Catch up on anything missed while connecting.
      void supabase
        .from("profile_sections")
        .select(SECTION_COLS)
        .eq("desk_id", deskId)
        .then(({ data }) => data && setSections(sortSections(data as SectionRow[])));
      if (filesOn) {
        void supabase
          .from("profile_files")
          .select(FILE_COLS)
          .eq("desk_id", deskId)
          .then(({ data }) => data && setFiles((data as FileRow[]).reduce(mergeFile, [] as FileRow[])));
      }
    });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, deskId, filesOn]);

  async function add() {
    setError(null);
    const { data, error } = await supabase
      .from("profile_sections")
      .insert({ desk_id: deskId, title: "", body: "", sort: nextSort(sections) })
      .select(SECTION_COLS)
      .single();
    if (error) return setError(`Couldn't add a note (${error.message}).`);
    setSections((l) => mergeSection(l, data as SectionRow));
    setOpen({ note: (data as SectionRow).id, fresh: true });
  }

  /** Markdown and text files become notes (Claude reads notes with every essay); anything else is kept as a file. */
  async function upload(list: File[]) {
    if (!list.length) return;
    setError(null);
    const problems: string[] = [];
    let sort = nextSort(sections);
    try {
      for (const file of list) {
        setBusy(`Adding ${file.name}…`);
        try {
          await uploadOne(file, sort, problems);
          if (uploadsAsNote(file)) sort++;
        } catch {
          problems.push(`${file.name} (it couldn't be read)`);
        }
      }
    } finally {
      setBusy(null);
      if (problems.length) setError(`Couldn't add ${problems.join("; ")}.`);
    }
  }

  /** One upload; what went wrong goes on `problems`. */
  async function uploadOne(file: File, sort: number, problems: string[]) {
    if (uploadsAsNote(file)) {
      const { data, error } = await supabase
        .from("profile_sections")
        .insert({ desk_id: deskId, title: noteTitle(file.name), body: await file.text(), sort })
        .select(SECTION_COLS)
        .single();
      if (error) problems.push(`${file.name} (${error.message})`);
      else setSections((l) => mergeSection(l, data as SectionRow));
      return;
    }
    if (!filesOn) return void problems.push(`${file.name} (run the latest database update to keep files other than notes)`);
    if (file.size > FILE_MAX) return void problems.push(`${file.name} (it's over 5 MB)`);
    if (file.size === 0) return void problems.push(`${file.name} (it's empty)`);
    const mime = file.type || "application/octet-stream";
    const { data, error } = await supabase.rpc("add_profile_file", { d: deskId, file_name: file.name, file_mime: mime, b64: await base64Of(file) });
    if (error) problems.push(`${file.name} (${error.message})`);
    else
      setFiles((l) =>
        mergeFile(l, { id: data as string, name: file.name, mime, size: file.size, added_by: "", created_at: new Date().toISOString() }),
      );
  }

  async function move(index: number, dir: -1 | 1) {
    const changes = moveSection(sections, index, dir);
    if (!changes) return;
    const before = sections;
    setSections((l) => sortSections(l.map((s) => ({ ...s, sort: changes.find((c) => c.id === s.id)?.sort ?? s.sort }))));
    const results = await Promise.all(changes.map((c) => supabase.from("profile_sections").update({ sort: c.sort }).eq("id", c.id)));
    const failed = results.find((r) => r.error);
    if (failed) {
      setSections(before);
      setError(`Couldn't move it (${failed.error!.message}).`);
    }
  }

  async function removeNote(id: string) {
    const { error } = await supabase.from("profile_sections").delete().eq("id", id);
    if (error) return setError(`Couldn't delete it (${error.message}).`);
    setOpen(null);
    setSections((l) => removeSection(l, id));
  }

  async function deleteFile(id: string) {
    const { error } = await supabase.from("profile_files").delete().eq("id", id);
    if (error) return setError(`Couldn't delete it (${error.message}).`);
    setOpen(null);
    setFiles((l) => removeFile(l, id));
  }

  const openNote = open && "note" in open ? sections.find((s) => s.id === open.note) : undefined;
  const openFile = open && "file" in open ? files.find((f) => f.id === open.file) : undefined;
  const empty = sections.length === 0 && files.length === 0;

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        if (!busy) void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-serif text-xl">Your files</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn" onClick={() => picker.current?.click()} disabled={!!busy}>
            Upload files
          </button>
          <button type="button" className="btn" onClick={() => void add()}>
            New note
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            aria-label="Choose files to upload"
            data-testid="profile-upload"
            onChange={(e) => {
              const chosen = [...(e.target.files ?? [])];
              e.target.value = "";
              void upload(chosen);
            }}
          />
        </div>
      </div>
      {empty ? (
        <p
          className={`rounded-md border border-dashed px-4 py-6 text-sm text-muted ${dragging ? "border-accent bg-accent-soft" : "border-line"}`}
        >
          Nothing here yet. Write a note yourself (your activities, a story about you, what you want to study and why), start the
          interview and Claude writes them as you talk, or upload files: a resume, or a school&apos;s form for your counselor to fill in.
        </p>
      ) : (
        <ul className={`card divide-y divide-line ${dragging ? "ring-2 ring-accent" : ""}`} aria-label="Your files">
          {sections.map((s, i) => {
            const name = s.title.trim() || "Untitled note";
            return (
              <li key={s.id} className="flex items-center gap-1 pr-2" data-testid="profile-section">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-bg"
                  onClick={() => setOpen({ note: s.id, fresh: false })}
                >
                  <KindIcon kind="note" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block text-xs text-muted">
                      Note · {countWords(s.body).toLocaleString("en-US")} words · {s.updated_by ? `by ${s.updated_by}` : "by you"} ·{" "}
                      <LocalDay at={s.updated_at} />
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
                  aria-label={`Move ${name} up`}
                  disabled={i === 0}
                  onClick={() => void move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
                  aria-label={`Move ${name} down`}
                  disabled={i === sections.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  ↓
                </button>
              </li>
            );
          })}
          {files.map((f) => (
            <li key={f.id} data-testid="profile-file">
              <button
                type="button"
                className="flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-bg"
                onClick={() => setOpen({ file: f.id })}
              >
                <KindIcon kind={fileKind(f)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="block text-xs text-muted">
                    {kindLabel(f)} · {formatSize(f.size)} · {f.added_by ? `filled in by ${f.added_by}` : "uploaded by you"} ·{" "}
                    <LocalDay at={f.created_at} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted" role="status">
        {busy ??
          "Drop files here or upload them: Markdown and text files become notes, and anything else (a PDF form, a resume, up to 5 MB) is kept for your counselor to read and fill in."}
      </p>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {openNote && open && "note" in open && (
        <NoteOverlay
          key={openNote.id}
          section={openNote}
          fresh={open.fresh}
          onClose={() => setOpen(null)}
          onRemove={() => removeNote(openNote.id)}
          onError={setError}
        />
      )}
      {openFile && <FileOverlay key={openFile.id} file={openFile} onClose={() => setOpen(null)} onRemove={() => deleteFile(openFile.id)} />}
    </div>
  );
}

/** A Word document's text, or nothing when it can't be read (it's shown for download instead). */
function wordText(bytes: Uint8Array): string | undefined {
  try {
    return docxText(bytes);
  } catch {
    return undefined;
  }
}

/** A file's bytes as base64, for the database. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function KindIcon({ kind }: { kind: FileKind | "note" }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" strokeLinejoin="round" />
      <path d="M9.5 1.5v3h3" strokeLinejoin="round" />
      {kind === "image" ? (
        <path d="M5.5 12.5l2-2.5 1.5 1.5 1-1 1.5 2M6.5 7.5h.01" strokeLinecap="round" strokeLinejoin="round" />
      ) : kind === "pdf" ? (
        <path d="M6 8.5h4.5M6 11h2.5" strokeLinecap="round" />
      ) : kind === "other" ? null : (
        <path d="M6 8h4.5M6 10.5h4.5" strokeLinecap="round" />
      )}
    </svg>
  );
}

/** One note, open over the page (the same overlay as comparing versions): its name, and its text formatted until clicked. */
function NoteOverlay({
  section,
  fresh,
  onClose,
  onRemove,
  onError,
}: {
  section: SectionRow;
  fresh: boolean;
  onClose: () => void;
  onRemove: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const supabase = supabaseBrowser();
  const ids = useId();
  const [draft, setDraft] = useState({ title: section.title, body: section.body });
  const [synced, setSynced] = useState(section.updated_at);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ title: string; body: string } | null>(null);
  // The last save failed: the text stays here (and saves with the next change), and closing asks twice.
  const failed = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warned, setWarned] = useState(false);

  // Someone else changed it (Claude, another tab): show theirs unless the student is typing here.
  if (section.updated_at !== synced && !focused && !dirty) {
    setSynced(section.updated_at);
    setDraft({ title: section.title, body: section.body });
  }

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const { error } = await supabase
      .from("profile_sections")
      .update({ title: next.title.slice(0, 200), body: next.body, updated_by: "", updated_at: new Date().toISOString() })
      .eq("id", section.id);
    if (error) {
      pending.current ??= next;
      failed.current = true;
      setSaveError(error.message);
      onError(`Couldn't save "${next.title || "a note"}" (${error.message}).`);
      return;
    }
    failed.current = false;
    if (!pending.current) setDirty(false);
    setSaveError(null);
    setWarned(false);
    onError(null);
  }, [supabase, section.id, onError]);

  const close = async () => {
    await flush();
    if (failed.current && !warned) return setWarned(true);
    onClose();
  };

  // Save whatever is left when it closes.
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  }, [flush]);
  useEffect(() => () => void latestFlush.current(), []);

  const change = (next: { title: string; body: string }) => {
    setDraft(next);
    setDirty(true);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_MS);
  };

  const focus = {
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      void flush();
    },
  };

  return (
    <Modal labelledBy={`${ids}-h`} onClose={() => void close()} placement="fill" className="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col" data-testid="profile-note">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-h`} className="sr-only">
              {draft.title.trim() || "Untitled note"}
            </h2>
            <input
              className="w-full bg-transparent font-serif text-lg outline-none"
              value={draft.title}
              placeholder="Name this note"
              aria-label="Note name"
              maxLength={200}
              data-autofocus={fresh ? true : undefined}
              onChange={(e) => change({ ...draft, title: e.target.value })}
              {...focus}
            />
            <p className="text-xs text-muted">
              {countWords(draft.body).toLocaleString("en-US")} words ·{" "}
              {saveError ? <span className="text-danger">not saved</span> : dirty ? "saving…" : "saved"} · Claude reads it before
              helping with any essay
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConfirmButton label="Delete" confirmLabel="Delete" question={`Delete "${draft.title.trim() || "this note"}"?`} onConfirm={onRemove} quiet />
            <button type="button" className="btn" onClick={() => void close()} data-autofocus={fresh ? undefined : true}>
              Close
            </button>
          </div>
        </div>
        {saveError && (
          <p role="alert" className="border-b border-line bg-danger-soft px-4 py-2 text-sm text-danger">
            Couldn&apos;t save this note ({saveError}). Your text is still here and saves when you type again.
            {warned ? " Close again to leave without saving it." : ""}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl">
            <FormattedTextarea
              className="field min-h-[50vh] resize-y text-[15px]"
              value={draft.body}
              placeholder="In your own words: what happened, who was there, what changed."
              aria-label="Note text"
              onChange={(e) => change({ ...draft, body: e.target.value })}
              {...focus}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

type Loaded = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; url: string; text?: string };

/** One file, open over the page: a PDF or image shown, text as text, anything else to download. */
function FileOverlay({ file, onClose, onRemove }: { file: FileRow; onClose: () => void; onRemove: () => Promise<void> }) {
  const supabase = supabaseBrowser();
  const ids = useId();
  const kind = fileKind(file);
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const type = kind === "pdf" ? "application/pdf" : kind === "image" ? imageMime(file) : file.mime;

  useEffect(() => {
    let url = "";
    let gone = false;
    void supabase.rpc("profile_file_content", { f: file.id }).then(({ data, error }) => {
      if (gone) return;
      if (error || !data) return setLoaded({ state: "error", message: error?.message ?? "It wasn't found." });
      const bin = atob((data as { b64: string }).b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type }));
      setLoaded({ state: "ready", url, text: kind === "text" ? new TextDecoder().decode(bytes) : kind === "word" ? wordText(bytes) : undefined });
    });
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [supabase, file.id, kind, type]);

  return (
    <Modal labelledBy={`${ids}-h`} onClose={onClose} placement="fill" className="flex flex-col">
      <div className="flex min-h-0 flex-1 flex-col" data-testid="profile-file-open">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={`${ids}-h`} className="truncate font-serif text-lg">
              {file.name}
            </h2>
            <p className="text-xs text-muted">
              {kindLabel(file)} · {formatSize(file.size)} · {file.added_by ? `filled in by ${file.added_by}` : "uploaded by you"} ·{" "}
              <LocalDay at={file.created_at} /> · your counselor can read it
              {kind === "pdf" ? " and fill it in" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loaded.state === "ready" && (
              <a className="btn" href={loaded.url} download={file.name}>
                Download
              </a>
            )}
            <ConfirmButton label="Delete" confirmLabel="Delete" question={`Delete "${file.name}"?`} onConfirm={onRemove} quiet />
            <button type="button" className="btn" onClick={onClose} data-autofocus>
              Close
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
          {loaded.state === "loading" ? (
            <p className="text-sm text-muted">Opening…</p>
          ) : loaded.state === "error" ? (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn&apos;t open it ({loaded.message}).</p>
          ) : kind === "pdf" ? (
            <iframe src={loaded.url} title={file.name} className="min-h-[60vh] w-full flex-1 rounded border border-line bg-white" />
          ) : kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a file from the database, shown as it is
            <img src={loaded.url} alt={file.name} className="mx-auto max-h-full max-w-full object-contain" />
          ) : loaded.text !== undefined ? (
            <div className="mx-auto w-full max-w-3xl">
              {kind === "word" && <p className="mb-3 text-xs text-muted">Its text, without the formatting: download it to see it as it looks.</p>}
              <pre className="whitespace-pre-wrap font-sans text-[15px]">{loaded.text}</pre>
            </div>
          ) : (
            <p className="text-sm text-muted">This kind of file can&apos;t be shown here: download it to open it.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
