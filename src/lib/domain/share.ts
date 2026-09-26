/** What someone on a share link can do: read, suggest edits, or edit (and suggest). */
export type ShareRole = "view" | "suggest" | "edit";

export const SHARE_ROLES: { value: ShareRole; label: string; short: string }[] = [
  { value: "edit", label: "Read and edit (or suggest)", short: "can edit" },
  { value: "suggest", label: "Read and suggest edits", short: "can suggest" },
  { value: "view", label: "Only read", short: "read only" },
];

export const asShareRole = (v: unknown): ShareRole => (v === "edit" || v === "suggest" ? v : "view");

export const shareRoleLabel = (r: string) => SHARE_ROLES.find((x) => x.value === r)?.short ?? "read only";

/** What a connector (Claude, ChatGPT, the counselor) may do with essays. */
export type EssayAccess = "read" | "suggest" | "edit";

export const ESSAY_ACCESS: { value: EssayAccess; label: string; short: string; about: string }[] = [
  { value: "read", label: "Only read and advise", short: "Read only", about: "Reads your essays and gives advice; changes nothing." },
  { value: "suggest", label: "Read and suggest edits", short: "Suggest", about: "Suggests edits that you accept or decline." },
  {
    value: "edit",
    label: "Read, suggest and write directly",
    short: "Write",
    about: "Can also draft and change your essays directly; the old text stays in History.",
  },
];

export const asEssayAccess = (v: unknown): EssayAccess => (v === "read" || v === "suggest" ? v : "edit");
