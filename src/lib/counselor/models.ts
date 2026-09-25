/*
 * The Claude models the counselor can run, by the aliases Claude Code accepts (it maps each to
 * the latest model of that name), and how hard it thinks. Which ones a student can use depends
 * on their Claude plan.
 */

export type ModelId = "haiku" | "sonnet" | "opus" | "fable";
export type EffortId = "low" | "medium" | "high";

export const MODELS: { id: ModelId; label: string; about: string }[] = [
  { id: "haiku", label: "Haiku", about: "The fastest. Good for quick questions." },
  { id: "sonnet", label: "Sonnet", about: "Fast and strong. Good for most things." },
  { id: "opus", label: "Opus", about: "Thinks more deeply; slower. For odds, full drafts and big decisions." },
  { id: "fable", label: "Fable", about: "Anthropic's newest model. Needs a plan that includes it." },
];

export const EFFORTS: { id: EffortId; label: string; about: string }[] = [
  { id: "low", label: "Low", about: "Answers quickly with little deliberation." },
  { id: "medium", label: "Medium", about: "Thinks things through; the usual choice." },
  { id: "high", label: "High", about: "Thinks hard before answering; slower." },
];

export const isModel = (v: unknown): v is ModelId => MODELS.some((m) => m.id === v);
export const isEffort = (v: unknown): v is EffortId => EFFORTS.some((e) => e.id === v);

export const modelLabel = (id: string | null | undefined) => MODELS.find((m) => m.id === id)?.label ?? "Sonnet";

const KEY = (surface: string) => `desk:model:${surface}`;

/** The model this browser last picked for a feature ("ask", "chat", "odds"), or "" for the counselor's default. */
export function storedModel(surface: string): ModelId | "" {
  try {
    const v = localStorage.getItem(KEY(surface));
    return isModel(v) ? v : "";
  } catch {
    return "";
  }
}

export function storeModel(surface: string, model: ModelId | "") {
  try {
    if (model) localStorage.setItem(KEY(surface), model);
    else localStorage.removeItem(KEY(surface));
  } catch {
    // Private mode: just don't remember.
  }
}

/** What an older counselor's speed meant, for a desk that hasn't stored a model yet. */
const SPEED_CHOICE: Record<string, { model: ModelId; effort: EffortId }> = {
  fast: { model: "sonnet", effort: "low" },
  balanced: { model: "sonnet", effort: "medium" },
  thorough: { model: "opus", effort: "high" },
};

/** The model a counselor runs and how hard it thinks, falling back on what its older speed meant. */
export function counselorChoice(c: { counselor_model?: string | null; counselor_effort?: string | null; counselor_speed?: string | null }): {
  model: ModelId;
  effort: EffortId;
} {
  const fromSpeed = SPEED_CHOICE[c.counselor_speed ?? "balanced"] ?? SPEED_CHOICE.balanced;
  return {
    model: isModel(c.counselor_model) ? c.counselor_model : fromSpeed.model,
    effort: isEffort(c.counselor_effort) ? c.counselor_effort : fromSpeed.effort,
  };
}
