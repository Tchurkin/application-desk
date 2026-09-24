/*
 * Rewrites of a highlighted passage come back inside the answer, each between <option> tags, so
 * any assistant can give them (the counselor by replying, a chat through answer_request). The
 * desk shows them in place of the passage in the essay. Pure, so it is tested without an editor.
 */

export interface ParsedOptions {
  /** Each rewrite, in order. */
  options: string[];
  /** Everything else in the answer: usually a line on how the options differ. */
  note: string;
}

const OPTION = /<option>\s*([\s\S]*?)\s*<\/option>/gi;

/** The options in an answer (finished ones only while it is still being written). */
export function parseOptions(answer: string): ParsedOptions {
  const options: string[] = [];
  for (const m of answer.matchAll(OPTION)) {
    const text = m[1].trim();
    if (text) options.push(text);
  }
  const note = answer
    .replace(OPTION, "")
    // An option still being written: not shown until it's complete.
    .replace(/<option>[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { options, note };
}
