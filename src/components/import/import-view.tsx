"use client";

import Link from "next/link";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { importPieces, type ImportResult } from "@/app/desk/import/actions";
import { googleConfig, googleReady, pickFromGoogle, prepareGoogle } from "@/lib/import/google";
import { guessPiece, planRows, splitAtHeadings, type DeskCollege, type DeskPiece, type ImportRow } from "@/lib/import/plan";
import { fileSources, textParagraphs, type SourceDoc } from "@/lib/import/sources";

/*
 * Bringing essays over from Google Docs: pick docs from Google Drive (each tab becomes a piece),
 * or upload Word files or a whole Drive folder downloaded as a .zip, or paste text. Every essay
 * is matched to a college and to a piece already on the desk where it can be; the student checks
 * the list, fixes anything, and imports.
 */

const noop = () => () => {};

export function ImportView({ colleges, pieces }: { colleges: DeskCollege[]; pieces: DeskPiece[] }) {
  const ids = useId();
  const google = useSyncExternalStore(noop, () => googleConfig() !== null, () => false);
  const [googleOk, setGoogleOk] = useState(false);
  const [docs, setDocs] = useState<Record<string, SourceDoc>>({});
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [split, setSplit] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");

  // Google's libraries load ahead, so sign-in can open straight from the click.
  useEffect(() => {
    if (!googleConfig()) return;
    let alive = true;
    prepareGoogle().then(
      () => alive && setGoogleOk(googleReady()),
      () => alive && setNotes((n) => [...n, "Couldn't load Google Drive. Check your connection, or upload files instead."]),
    );
    return () => {
      alive = false;
    };
  }, []);

  const taken = (list: ImportRow[]) => new Set(list.filter((r) => r.include && r.pieceId).map((r) => r.pieceId!));

  function add(found: SourceDoc[]) {
    if (!found.length) return;
    setResult(null);
    setDocs((d) => ({ ...d, ...Object.fromEntries(found.map((x) => [x.key, x])) }));
    setRows((list) => [...list, ...planRows(found, colleges, pieces, taken(list))]);
  }

  const nextKey = () => crypto.randomUUID().slice(0, 8);

  async function onGoogle() {
    const cfg = googleConfig();
    if (!cfg) return;
    setNotes([]);
    try {
      const { docs: found, skippedFolders, failed } = await pickFromGoogle(cfg, (n) => setBusy(n ? `Reading ${n} doc${n === 1 ? "" : "s"}…` : null));
      const extra: string[] = [];
      if (skippedFolders) extra.push("A folder can't be picked as a whole: open it in the picker and select the docs inside (Shift-click selects several).");
      if (failed.length) extra.push(`Couldn't read: ${failed.join(", ")}.`);
      setNotes(extra);
      add(found);
    } catch (e) {
      setNotes([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setNotes([]);
    setBusy(`Reading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    const found: SourceDoc[] = [];
    const problems: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const got = fileSources(f.name, new Uint8Array(await f.arrayBuffer()), nextKey());
        if (!got.length) problems.push(`${f.name}: no essays found inside.`);
        found.push(...got);
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    setNotes(problems);
    add(found);
    setBusy(null);
  }

  function onPaste() {
    if (!pasteText.trim()) return;
    add([{ key: nextKey(), title: pasteTitle.trim() || "Pasted essay", from: "", paragraphs: textParagraphs(pasteText) }]);
    setPasteText("");
    setPasteTitle("");
  }

  const update = (key: string, patch: Partial<ImportRow>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function setCollege(r: ImportRow, collegeId: string | null) {
    const others = taken(rows.filter((x) => x.key !== r.key));
    update(r.key, { collegeId, pieceId: guessPiece(r.title, collegeId, pieces, others) });
  }

  /** Split a doc at its headings, or put it back together. */
  function toggleSplit(r: ImportRow) {
    const baseKey = r.key.split("#")[0];
    const doc = docs[baseKey];
    if (!doc) return;
    const on = !split[baseKey];
    setSplit((s) => ({ ...s, [baseKey]: on }));
    setRows((list) => {
      const at = list.findIndex((x) => x.key.split("#")[0] === baseKey);
      const rest = list.filter((x) => x.key.split("#")[0] !== baseKey);
      const planned = planRows(on ? splitAtHeadings(doc) : [doc], colleges, pieces, taken(rest));
      return [...rest.slice(0, at), ...planned, ...rest.slice(at)];
    });
  }

  async function onImport() {
    const chosen = rows.filter((r) => r.include);
    if (!chosen.length) return;
    setBusy(`Importing ${chosen.length} piece${chosen.length === 1 ? "" : "s"}…`);
    try {
      const r = await importPieces(chosen.map((x) => ({ title: x.title, text: x.text, collegeId: x.collegeId, pieceId: x.pieceId })));
      setResult(r);
      if (r.imported) {
        setRows([]);
        setDocs({});
        setSplit({});
      }
    } catch (e) {
      setResult({ imported: 0, errors: [(e as Error).message] });
    } finally {
      setBusy(null);
    }
  }

  const chosen = rows.filter((r) => r.include).length;
  const collegeName = (id: string | null) => colleges.find((c) => c.id === id)?.name ?? "independent";

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-3" aria-label="Where your essays are">
        <div className="card flex flex-col gap-2 px-4 py-4">
          <h2 className="font-serif text-lg">Google Drive</h2>
          {google ? (
            <>
              <p className="text-sm text-muted">
                Pick your essay docs: a doc for each essay, or one doc with a tab for each (every tab becomes its own piece). Only the docs
                you pick are shared with this site.
              </p>
              <button type="button" className="btn btn-primary self-start" disabled={!googleOk || !!busy} onClick={() => void onGoogle()}>
                Choose from Google Drive
              </button>
            </>
          ) : (
            <p className="text-sm text-muted">
              Direct import from Google Drive isn&apos;t set up on this site yet. Download your docs instead (next box): it takes a few
              seconds.
            </p>
          )}
        </div>

        <div className="card flex flex-col gap-2 px-4 py-4">
          <h2 className="font-serif text-lg">Files</h2>
          <p className="text-sm text-muted">
            A whole folder: in Google Drive, right-click it → Download, and upload the .zip. One doc: File → Download → Microsoft Word
            (.docx). Text files work too.
          </p>
          <label htmlFor={`${ids}-files`} className="btn self-start">
            Upload files
          </label>
          <input
            id={`${ids}-files`}
            type="file"
            multiple
            accept=".docx,.zip,.txt,.md"
            className="sr-only"
            aria-label="Upload essay files"
            disabled={!!busy}
            onChange={(e) => {
              void onFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        <div className="card flex flex-col gap-2 px-4 py-4">
          <h2 className="font-serif text-lg">Paste</h2>
          <input className="field" placeholder="Title, e.g. Why Stanford?" aria-label="Pasted essay title" value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} />
          <textarea className="field min-h-20" placeholder="Paste an essay" aria-label="Pasted essay" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <button type="button" className="btn self-start" disabled={!pasteText.trim()} onClick={onPaste}>
            Add
          </button>
        </div>
      </section>

      <div role="status" aria-live="polite" className="text-sm">
        {busy && <p className="text-muted">{busy}</p>}
        {notes.map((n) => (
          <p key={n} className="text-warn">
            {n}
          </p>
        ))}
        {result && (
          <div className={`rounded-md px-3 py-2 ${result.errors.length ? "bg-warn-soft" : "bg-accent-soft"}`} data-testid="import-result">
            {result.imported > 0 && (
              <p>
                Imported {result.imported} piece{result.imported === 1 ? "" : "s"}.{" "}
                <Link href="/desk" className="underline underline-offset-2">
                  See your board
                </Link>
                {result.firstPieceId && (
                  <>
                    {" or "}
                    <Link href={`/desk/piece/${result.firstPieceId}`} className="underline underline-offset-2">
                      start writing
                    </Link>
                  </>
                )}
                .
              </p>
            )}
            {result.errors.map((e) => (
              <p key={e} className="text-danger">
                {e}
              </p>
            ))}
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <section aria-labelledby={`${ids}-review`} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id={`${ids}-review`} className="font-serif text-xl">
              Check before importing
            </h2>
            <p className="text-sm text-muted">
              Each essay goes to the college and piece shown. Filling in a piece that already has text keeps the old text in its History.
            </p>
          </div>
          <ol className="flex flex-col gap-2" aria-label="Essays to import">
            {rows.map((r) => {
              const target = pieces.find((p) => p.id === r.pieceId);
              const others = taken(rows.filter((x) => x.key !== r.key));
              const options = pieces.filter((p) => p.college_id === r.collegeId && (p.id === r.pieceId || !others.has(p.id)));
              const baseKey = r.key.split("#")[0];
              return (
                <li key={r.key} className={`card flex flex-col gap-2 px-3 py-3 ${r.include ? "" : "opacity-60"}`} data-testid="import-row">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.include}
                      aria-label={`Import ${r.title}`}
                      onChange={(e) => update(r.key, { include: e.target.checked })}
                    />
                    <input
                      className="field min-w-0 flex-1 font-medium"
                      value={r.title}
                      maxLength={300}
                      aria-label="Title"
                      onChange={(e) => update(r.key, { title: e.target.value })}
                    />
                    <span className="text-xs text-muted">{r.words} words</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label className="flex items-center gap-1">
                      <span className="text-muted">College</span>
                      <select
                        className="rounded-md border border-line bg-panel px-1.5 py-1"
                        value={r.collegeId ?? ""}
                        aria-label={`College for ${r.title}`}
                        onChange={(e) => setCollege(r, e.target.value || null)}
                      >
                        <option value="">Independent (no college)</option>
                        {colleges.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <span className="text-muted">Into</span>
                      <select
                        className="rounded-md border border-line bg-panel px-1.5 py-1"
                        value={r.pieceId ?? ""}
                        aria-label={`Piece for ${r.title}`}
                        onChange={(e) => update(r.key, { pieceId: e.target.value || null })}
                      >
                        <option value="">A new piece</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                            {p.word_count ? ` (replaces ${p.word_count} words)` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(r.parts > 1 || split[baseKey]) && (
                      <button type="button" className="text-xs underline underline-offset-2" onClick={() => toggleSplit(r)}>
                        {split[baseKey] ? "Keep as one piece" : `Split into ${r.parts} pieces at its headings`}
                      </button>
                    )}
                  </div>
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">
                      {r.from ? `From ${r.from} · ` : ""}
                      {target ? `Fills in “${target.title}” (${collegeName(r.collegeId)})` : `New piece (${collegeName(r.collegeId)})`}
                    </summary>
                    <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap text-ink">{r.text || "(empty)"}</p>
                  </details>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary" disabled={!chosen || !!busy} onClick={() => void onImport()}>
              Import {chosen} piece{chosen === 1 ? "" : "s"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!!busy}
              onClick={() => {
                setRows([]);
                setDocs({});
                setSplit({});
              }}
            >
              Start over
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
