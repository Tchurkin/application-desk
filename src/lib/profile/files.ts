/*
 * Files in the Profile folder (migration 20261015): what the page lists and the counselor reads.
 * Pure, shared by the page and the connector.
 */

export interface FileRow {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** "" when the student added it, else the assistant's label (a form it filled in). */
  added_by: string;
  created_at: string;
}

export const FILE_COLS = "id, name, mime, size, added_by, created_at";

/** Up to 5 MB a file and 25 MB a desk; the database holds the same line. */
export const FILE_MAX = 5 * 1024 * 1024;
export const FILES_TOTAL_MAX = 25 * 1024 * 1024;

/** The longest note (profile_sections.body); a longer text file stays a file. */
export const NOTE_MAX = 20_000;

/** Apply an added file (oldest first, as the list shows them). */
export function mergeFile(list: FileRow[], row: FileRow): FileRow[] {
  return [...list.filter((f) => f.id !== row.id), row].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function removeFile(list: FileRow[], id: string): FileRow[] {
  const rest = list.filter((f) => f.id !== id);
  return rest.length === list.length ? list : rest;
}

export type FileKind ="pdf" | "image" | "text" | "word" | "other";

const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

export function fileKind(f: { name: string; mime: string }): FileKind {
  const m = f.mime.toLowerCase();
  const e = ext(f.name);
  if (m === "application/pdf" || e === "pdf") return "pdf";
  if (/^image\/(png|jpeg|gif|webp)$/.test(m) || ["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "image";
  if (m.includes("wordprocessingml") || e === "docx") return "word";
  if (m.startsWith("text/") || m === "application/json" || ["txt", "md", "markdown", "csv", "json"].includes(e)) return "text";
  return "other";
}

/** The file's type, for the page ("PDF", "Image", ...). */
export function kindLabel(f: { name: string; mime: string }): string {
  const k = fileKind(f);
  if (k === "pdf") return "PDF";
  if (k === "image") return "Image";
  if (k === "word") return "Word document";
  if (k === "text") return "Text";
  return ext(f.name).toUpperCase() || "File";
}

/** An image type the browser and the assistant both show. */
export function imageMime(f: { name: string; mime: string }): string {
  if (/^image\/(png|jpeg|gif|webp)$/.test(f.mime)) return f.mime;
  const e = ext(f.name);
  return e === "jpg" ? "image/jpeg" : `image/${e}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A Markdown or plain-text upload short enough becomes a note (Claude reads notes with every essay). */
export function uploadsAsNote(f: { name: string; type: string; size: number }): boolean {
  const e = ext(f.name);
  const texty = ["md", "markdown", "txt"].includes(e) || f.type === "text/markdown" || f.type === "text/plain";
  // Bytes, while a note's limit is characters: text has no more characters than bytes, so it fits.
  return texty && f.size <= NOTE_MAX;
}

/** The note's name from the file's: "My story.md" is "My story". */
export const noteTitle = (fileName: string) => fileName.replace(/\.(md|markdown|txt)$/i, "").trim().slice(0, 200);

/** A "filled" copy's name: "Waiver.pdf" is "Waiver (filled).pdf". */
export function filledName(name: string, saveAs?: string): string {
  const wanted = saveAs?.trim();
  if (wanted) return /\.pdf$/i.test(wanted) ? wanted.slice(0, 200) : `${wanted.slice(0, 196)}.pdf`;
  const base = name.replace(/\.pdf$/i, "");
  return `${base.slice(0, 185)} (filled).pdf`;
}

/** The files, as read_profile lists them for the assistant. */
export function renderFileList(files: FileRow[]): string {
  if (!files.length) return "";
  const lines = [`## Files on the Profile page (${files.length})`];
  for (const f of files) {
    const who = f.added_by ? `filled in by ${f.added_by}` : "from the student";
    lines.push(`- ${f.name} (${kindLabel(f)}, ${formatSize(f.size)}, ${who}) [file_id: ${f.id}]`);
  }
  lines.push("Read one with read_profile_file. A PDF form can be filled in with fill_pdf_form, which saves a filled copy next to it.");
  return lines.join("\n");
}
