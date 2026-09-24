import { strFromU8, unzipSync } from "fflate";

/*
 * Reading essays out of what students keep them in: Google Docs (a doc per essay, or one doc
 * with a tab per essay), Word files, a Google Drive folder downloaded as a .zip, and plain text.
 * Everything becomes SourceDocs: a title, where it came from, and its paragraphs. Pure, so it is
 * tested without a browser or Google.
 */

export interface Para {
  text: string;
  /** 0 for body text; 1 for a title or top-level heading, 2 and up for lower headings. */
  heading: number;
}

export interface SourceDoc {
  /** Unique within one import. */
  key: string;
  title: string;
  /** Where it came from: the Google Doc a tab is in, or the folder a file was in. */
  from: string;
  paragraphs: Para[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Heading level from a Word paragraph style id ("Title", "Heading1", "heading 2"…), else 0. */
function wordHeading(style: string | undefined): number {
  if (!style) return 0;
  const s = style.toLowerCase().replace(/\s+/g, "");
  if (s === "title") return 1;
  const m = /^heading([1-6])$/.exec(s);
  return m ? Number(m[1]) : 0;
}

/** The paragraphs of a Word document's main text (word/document.xml). */
export function wordXmlParagraphs(xml: string): Para[] {
  const body = /<w:body\b[^>]*>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const out: Para[] = [];
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = m[1] ?? "";
    const style = /<w:pStyle\b[^>]*w:val="([^"]*)"/.exec(inner)?.[1];
    let text = "";
    for (const t of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
      if (t[1] !== undefined) text += decodeXml(t[1]);
      else if (t[0].startsWith("<w:tab")) text += "\t";
      else text += "\n";
    }
    out.push({ text, heading: wordHeading(style) });
  }
  return out;
}

/** A .docx file's paragraphs. Throws if it isn't a Word document. */
export function docxParagraphs(bytes: Uint8Array): Para[] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("This isn't a Word document (.docx).");
  return wordXmlParagraphs(strFromU8(xml));
}

/** Plain text: one paragraph per line; Markdown "#" headings count as headings. */
export function textParagraphs(text: string): Para[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      return m ? { text: m[2], heading: m[1].length } : { text: line, heading: 0 };
    });
}

const baseName = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/**
 * One uploaded file as SourceDocs: a .docx or .txt/.md is one; a .zip (a Google Drive folder
 * download) is every .docx, .txt and .md inside it, with its folder as `from`.
 */
export function fileSources(name: string, bytes: Uint8Array, keyPrefix: string): SourceDoc[] {
  const lower = name.toLowerCase();
  if (lower.endsWith(".docx")) {
    return [{ key: keyPrefix, title: baseName(name), from: "", paragraphs: docxParagraphs(bytes) }];
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return [{ key: keyPrefix, title: baseName(name), from: "", paragraphs: textParagraphs(strFromU8(bytes)) }];
  }
  if (lower.endsWith(".zip")) {
    const files = unzipSync(bytes, { filter: (f) => /\.(docx|txt|md)$/i.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) });
    return Object.keys(files)
      .sort()
      .flatMap((path, i) => {
        try {
          const paragraphs = path.toLowerCase().endsWith(".docx") ? docxParagraphs(files[path]) : textParagraphs(strFromU8(files[path]));
          return [{ key: `${keyPrefix}:${i}`, title: baseName(path), from: folderOf(path) || baseName(name), paragraphs }];
        } catch {
          return [];
        }
      });
  }
  throw new Error(`${name}: use .docx, .zip, .txt or .md files. (In Google Docs: File → Download → Microsoft Word.)`);
}

// ─── Google Docs (the Docs API's JSON) ───────────────────────────────────────

interface GElement {
  paragraph?: { elements?: { textRun?: { content?: string } }[]; paragraphStyle?: { namedStyleType?: string } };
  table?: { tableRows?: { tableCells?: { content?: GElement[] }[] }[] };
}
interface GTab {
  tabProperties?: { tabId?: string; title?: string };
  documentTab?: { body?: { content?: GElement[] } };
  childTabs?: GTab[];
}
export interface GDoc {
  documentId?: string;
  title?: string;
  body?: { content?: GElement[] };
  tabs?: GTab[];
}

function googleHeading(style: string | undefined): number {
  if (style === "TITLE") return 1;
  const m = /^HEADING_([1-6])$/.exec(style ?? "");
  return m ? Number(m[1]) : 0;
}

function googleParagraphs(content: GElement[] | undefined): Para[] {
  const out: Para[] = [];
  for (const el of content ?? []) {
    if (el.paragraph) {
      const text = (el.paragraph.elements ?? []).map((e) => e.textRun?.content ?? "").join("").replace(/\n$/, "");
      out.push({ text, heading: googleHeading(el.paragraph.paragraphStyle?.namedStyleType) });
    } else if (el.table) {
      for (const row of el.table.tableRows ?? []) for (const cell of row.tableCells ?? []) out.push(...googleParagraphs(cell.content));
    }
  }
  return out;
}

function flattenTabs(tabs: GTab[]): GTab[] {
  return tabs.flatMap((t) => [t, ...flattenTabs(t.childTabs ?? [])]);
}

/** A Google Doc as SourceDocs: one per tab when it has several, else the doc itself. */
export function googleDocSources(doc: GDoc, keyPrefix: string): SourceDoc[] {
  const title = doc.title?.trim() || "Untitled document";
  const tabs = flattenTabs(doc.tabs ?? []);
  if (tabs.length > 1) {
    return tabs.map((t, i) => ({
      key: `${keyPrefix}:${t.tabProperties?.tabId ?? i}`,
      title: t.tabProperties?.title?.trim() || `${title} (tab ${i + 1})`,
      from: title,
      paragraphs: googleParagraphs(t.documentTab?.body?.content),
    }));
  }
  const content = tabs.length === 1 ? tabs[0].documentTab?.body?.content : doc.body?.content;
  return [{ key: keyPrefix, title, from: "", paragraphs: googleParagraphs(content) }];
}
