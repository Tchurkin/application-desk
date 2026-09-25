import { strToU8, zipSync } from "fflate";

/*
 * "Download all my writing": every piece as a Word file (which Google Docs opens too), in a
 * folder per college, plus everything on the desk as JSON. Pure, so it is tested without a
 * database; the route (src/app/desk/export/route.ts) gathers the pieces.
 */

export interface ExportPiece {
  title: string;
  /** Its college's name, or null for an independent piece. */
  college: string | null;
  prompt: string;
  notes: string;
  /** The text, paragraphs separated by "\n". */
  text: string;
}

export interface ExportInput {
  deskTitle: string;
  /** YYYY-MM-DD, for the README. */
  date: string;
  pieces: ExportPiece[];
  /** Everything on the desk, written as everything.json. */
  data: unknown;
}

export const INDEPENDENT_FOLDER = "Independent pieces";

/** A name Windows, Mac, Word and Google Drive all take: no reserved characters, not too long. */
export function safeName(s: string, fallback = "Untitled"): string {
  const t = s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return t.slice(0, 80).trim() || fallback;
}

/** Text safe inside XML: escaped, and without the control characters XML forbids. */
function xmlText(s: string): string {
  return (
    s
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
  );
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraph(line: string, run = ""): string {
  const text = line ? `<w:r>${run ? `<w:rPr>${run}</w:rPr>` : ""}<w:t xml:space="preserve">${xmlText(line)}</w:t></w:r>` : "";
  return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr>${text}</w:p>`;
}

/** A minimal Word document: the title, the prompt in italics, the text, then the notes. */
export function docx(p: Pick<ExportPiece, "title" | "prompt" | "text" | "notes">): Uint8Array {
  const body = [paragraph(p.title || "Untitled", '<w:b/><w:sz w:val="32"/>')];
  if (p.prompt.trim()) body.push(...p.prompt.trim().split("\n").map((l) => paragraph(l, "<w:i/>")));
  body.push(...(p.text ? p.text.split("\n") : [""]).map((l) => paragraph(l)));
  if (p.notes.trim()) {
    body.push(paragraph("Notes (not part of the essay)", "<w:b/>"), ...p.notes.trim().split("\n").map((l) => paragraph(l, "<w:i/>")));
  }
  const document =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="${W}"><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`;
  const types =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;
  return zipSync({
    "[Content_Types].xml": strToU8(types),
    "_rels/.rels": strToU8(rels),
    "word/document.xml": strToU8(document),
  });
}

/** Where each piece goes in the download; two with the same name get " (2)", " (3)". */
export function piecePaths(pieces: Pick<ExportPiece, "title" | "college">[]): string[] {
  const taken = new Set<string>();
  return pieces.map((p) => {
    const folder = p.college === null ? INDEPENDENT_FOLDER : safeName(p.college, "College");
    const base = `${folder}/${safeName(p.title)}`;
    let path = `${base}.docx`;
    for (let n = 2; taken.has(path.toLowerCase()); n++) path = `${base} (${n}).docx`;
    taken.add(path.toLowerCase());
    return path;
  });
}

export function buildArchive(input: ExportInput): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const paths = piecePaths(input.pieces);
  input.pieces.forEach((p, i) => (files[paths[i]] = docx(p)));
  files["README.txt"] = strToU8(
    [
      `${input.deskTitle}: everything you wrote, downloaded ${input.date}.`,
      "",
      `Each piece is a Word file (Google Docs opens it too), in a folder for its college; pieces of their own are in "${INDEPENDENT_FOLDER}".`,
      "everything.json holds the whole desk: colleges, pieces, your profile and academics, recommenders and letters.",
      "",
    ].join("\r\n"),
  );
  files["everything.json"] = strToU8(JSON.stringify(input.data, null, 2));
  return zipSync(files, { level: 6 });
}
