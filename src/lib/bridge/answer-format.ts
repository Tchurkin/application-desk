/*
 * The assistant's answer, read as a little Markdown: paragraphs, **bold**, *italic*, `code`,
 * "- " and "1. " lists, "> " quotes and "#" headings. It becomes plain data that React renders
 * as text nodes, so nothing in an answer is ever treated as HTML.
 */

export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  code?: true;
}

export type Line = Span[];

export type Block =
  | { kind: "p"; lines: Line[] }
  | { kind: "heading"; spans: Line }
  | { kind: "quote"; lines: Line[] }
  | { kind: "ul"; items: Line[] }
  | { kind: "ol"; start: number; items: Line[] };

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;

// **bold**, __bold__, `code`, *italic* (the italic must hug its text, so "2 * 3 * 4" stays).
const INLINE = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`|\*([^*\s](?:[^*\n]*?[^*\s])?)\*/g;

export function parseInline(s: string): Line {
  const out: Line = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: s.slice(last, at) });
    if (m[1] !== undefined || m[2] !== undefined) out.push({ text: m[1] ?? m[2], bold: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else out.push({ text: m[4], italic: true });
    last = at + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function parseAnswer(text: string): Block[] {
  const blocks: Block[] = [];
  let open: Block | null = null;
  const close = () => {
    if (open) blocks.push(open);
    open = null;
  };
  // The block being built, if it is of kind k. (Read through a closure: `open` changes in close().)
  const openAs = <K extends Block["kind"]>(k: K): Of<K> | null => (open?.kind === k ? (open as Of<K>) : null);

  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || RULE.test(line)) {
      close();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      blocks.push({ kind: "heading", spans: parseInline(heading[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      let list = openAs("ul");
      if (!list) {
        close();
        list = { kind: "ul", items: [] };
      }
      list.items.push(parseInline(bullet[1]));
      open = list;
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      let list = openAs("ol");
      if (!list) {
        close();
        list = { kind: "ol", start: Number(numbered[1]), items: [] };
      }
      list.items.push(parseInline(numbered[2]));
      open = list;
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      let q = openAs("quote");
      if (!q) {
        close();
        q = { kind: "quote", lines: [] };
      }
      q.lines.push(parseInline(quote[1]));
      open = q;
      continue;
    }
    // An indented line right under a list item carries that item on.
    const inList = openAs("ul") ?? openAs("ol");
    if (inList && /^\s/.test(line)) {
      const items = inList.items;
      items[items.length - 1] = [...items[items.length - 1], { text: " " }, ...parseInline(line.trim())];
      continue;
    }
    let p = openAs("p");
    if (!p) {
      close();
      p = { kind: "p", lines: [] };
    }
    p.lines.push(parseInline(line.trim()));
    open = p;
  }
  close();
  return blocks;
}
