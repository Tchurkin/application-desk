import {
  PDFButton,
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  StandardFonts,
  type PDFField,
  type PDFFont,
} from "pdf-lib";

/*
 * Reading the files in the Profile folder for the counselor, and filling in PDF forms: a school's
 * form comes back as a new file next to the original, with the fields filled and signatures left
 * for the student.
 */

export type FieldKind = "text" | "checkbox" | "radio" | "dropdown" | "list" | "signature" | "button";

export interface PdfField {
  name: string;
  kind: FieldKind;
  /** What it holds now: text, "checked"/"not checked", or the choices made. */
  value: string;
  options?: string[];
  maxLength?: number;
  readOnly?: boolean;
}

function kindOf(f: PDFField): FieldKind | null {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFDropdown) return "dropdown";
  if (f instanceof PDFOptionList) return "list";
  if (f instanceof PDFSignature) return "signature";
  if (f instanceof PDFButton) return "button";
  return null;
}

async function load(bytes: Uint8Array) {
  return PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

export const PROTECTED =
  "This PDF is protected against changes, so it can't be filled in here. Ask the school for an unprotected copy, or tell the student what to write in each blank.";

/** pdf-lib throws reading an empty rich-text field; empty is what it holds. */
function textOf(f: PDFTextField): string {
  try {
    return f.getText() ?? "";
  } catch {
    return "";
  }
}

function describe(f: PDFField): PdfField | null {
  const kind = kindOf(f);
  if (!kind) return null;
  const base = { name: f.getName(), kind, readOnly: f.isReadOnly() || undefined };
  if (f instanceof PDFTextField) return { ...base, value: textOf(f), maxLength: f.getMaxLength() };
  if (f instanceof PDFCheckBox) return { ...base, value: f.isChecked() ? "checked" : "not checked" };
  if (f instanceof PDFRadioGroup) return { ...base, value: f.getSelected() ?? "", options: f.getOptions() };
  if (f instanceof PDFDropdown || f instanceof PDFOptionList) return { ...base, value: f.getSelected().join(", "), options: f.getOptions() };
  return { ...base, value: "" };
}

/**
 * The PDF's fillable fields, in the form's order ([] for a PDF that is only a picture of a form),
 * or "protected" for an encrypted one (pdf-lib can't decrypt: its names would be gibberish).
 */
export async function pdfFields(bytes: Uint8Array): Promise<PdfField[] | "protected"> {
  const doc = await load(bytes);
  if (doc.isEncrypted) return "protected";
  return doc
    .getForm()
    .getFields()
    .map(describe)
    .filter((f): f is PdfField => !!f);
}

/** The PDF's text, a string a page. */
export async function pdfText(bytes: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  // A copy: pdf.js takes the buffer it is given.
  const pdf = await getDocumentProxy(bytes.slice());
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

const YES = new Set(["true", "yes", "y", "on", "checked", "check", "x", "1"]);
const NO = new Set(["false", "no", "n", "off", "unchecked", "", "0"]);

/** The option the value names, matched ignoring case and spaces at the ends. */
function pick(options: string[], value: string): string | undefined {
  const v = value.trim().toLowerCase();
  return options.find((o) => o === value) ?? options.find((o) => o.trim().toLowerCase() === v);
}

export type FillValue = string | boolean | number | string[];

export interface FillResult {
  bytes: Uint8Array;
  filled: string[];
  skipped: { name: string; why: string }[];
}

/** Fill a PDF form's fields by name, returning the new PDF (the original is left as it was). */
export async function fillPdf(bytes: Uint8Array, values: Record<string, FillValue>): Promise<FillResult> {
  const doc = await load(bytes);
  // Saving would write plain text under the old encryption: a copy nothing can open.
  if (doc.isEncrypted) throw new Error(PROTECTED);
  const form = doc.getForm();
  const fields = new Map(form.getFields().map((f) => [f.getName(), f]));
  const filled: string[] = [];
  const skipped: FillResult["skipped"] = [];
  let font: PDFFont | null = null;
  const helvetica = async () => (font ??= await doc.embedFont(StandardFonts.Helvetica));

  for (const [name, raw] of Object.entries(values)) {
    const f = fields.get(name);
    if (!f) {
      skipped.push({ name, why: "no field has that name" });
      continue;
    }
    if (f.isReadOnly()) {
      skipped.push({ name, why: "the form doesn't let it be changed" });
      continue;
    }
    const one = Array.isArray(raw) ? raw.join(", ") : String(raw);
    try {
      if (f instanceof PDFTextField) {
        const max = f.getMaxLength();
        if (max !== undefined && one.length > max) {
          skipped.push({ name, why: `longer than the field allows (${max} characters)` });
          continue;
        }
        const before = textOf(f);
        f.setText(one);
        try {
          f.updateAppearances(await helvetica());
        } catch {
          f.setText(before);
          skipped.push({ name, why: "it has characters the form can't show (use plain letters)" });
          continue;
        }
      } else if (f instanceof PDFCheckBox) {
        const v = one.trim().toLowerCase();
        if (raw === true || YES.has(v)) f.check();
        else if (raw === false || NO.has(v)) f.uncheck();
        else {
          skipped.push({ name, why: "a checkbox takes true or false" });
          continue;
        }
      } else if (f instanceof PDFRadioGroup) {
        const o = pick(f.getOptions(), one);
        if (!o) {
          skipped.push({ name, why: `choose one of: ${f.getOptions().join(", ")}` });
          continue;
        }
        f.select(o);
      } else if (f instanceof PDFDropdown || f instanceof PDFOptionList) {
        const wanted = Array.isArray(raw) ? raw.map(String) : [one];
        const options = f.getOptions();
        const chosen = wanted.map((w) => pick(options, w) ?? (f instanceof PDFDropdown && f.isEditable() ? w : undefined));
        if (chosen.some((c) => c === undefined)) {
          skipped.push({ name, why: `choose from: ${options.join(", ")}` });
          continue;
        }
        const before = f.getSelected();
        f.select(chosen as string[]);
        try {
          f.updateAppearances(await helvetica());
        } catch {
          if (before.length) f.select(before);
          else f.clear();
          skipped.push({ name, why: "it has characters the form can't show (use plain letters)" });
          continue;
        }
      } else if (f instanceof PDFSignature) {
        skipped.push({ name, why: "a signature: the student signs it themselves" });
        continue;
      } else {
        skipped.push({ name, why: "not a field that takes a value" });
        continue;
      }
      filled.push(name);
    } catch (e) {
      skipped.push({ name, why: (e as Error).message });
    }
  }
  return { bytes: await doc.save({ updateFieldAppearances: false }), filled, skipped };
}

const TEXT_MAX = 60_000;

/** read_profile_file's reply for a PDF: its fields (what fill_pdf_form takes) and its text. */
export function renderPdf(name: string, fields: PdfField[] | "protected", pages: string[], max = TEXT_MAX): string {
  const lines = [`# ${name} (PDF, ${pages.length} page${pages.length === 1 ? "" : "s"})`];
  if (fields === "protected") {
    lines.push("", PROTECTED);
  } else if (fields.length) {
    lines.push("", `## Form fields (${fields.length}): fill them with fill_pdf_form, by these names`);
    for (const f of fields) {
      const bits: string[] = [f.kind];
      if (f.options?.length) bits.push(`one of: ${f.options.join(" | ")}`);
      if (f.maxLength !== undefined) bits.push(`up to ${f.maxLength} characters`);
      if (f.readOnly) bits.push("read-only");
      lines.push(`- "${f.name}" (${bits.join("; ")})${f.value ? `: now ${JSON.stringify(f.value)}` : ""}`);
    }
  } else {
    lines.push(
      "",
      "This PDF has no fillable fields, so fill_pdf_form can't fill it. Tell the student what to write in each blank, or ask the school for a fillable version.",
    );
  }
  lines.push("", "## Text");
  let used = 0;
  for (let i = 0; i < pages.length; i++) {
    const t = pages[i].trim();
    if (used + t.length > max) {
      lines.push("", `[The rest (pages ${i + 1} to ${pages.length}) is too long to show here.]`);
      break;
    }
    lines.push("", `--- Page ${i + 1} ---`, t || "(no text on this page: it may be a scan)");
    used += t.length;
  }
  return lines.join("\n");
}

/** Text cut to what one reply carries. */
export function clipText(t: string, max = TEXT_MAX): string {
  return t.length <= max ? t : `${t.slice(0, max)}\n\n[The rest (${(t.length - max).toLocaleString("en-US")} more characters) is too long to show here.]`;
}
