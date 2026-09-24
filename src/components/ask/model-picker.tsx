"use client";

import { useState, useSyncExternalStore } from "react";
import { MODELS, modelLabel, storedModel, storeModel, type ModelId } from "@/lib/counselor/models";

/**
 * Which Claude model answers a request: the counselor's default, or one picked for this feature
 * (remembered per browser). Only the counselor on the student's computer follows it; a Claude or
 * ChatGPT chat uses the model picked in that chat.
 */
export function useModelChoice(surface: string): [ModelId | "", (m: ModelId | "") => void] {
  const stored = useSyncExternalStore(
    () => () => {},
    () => storedModel(surface),
    () => "" as const,
  );
  const [picked, setPicked] = useState<ModelId | "" | null>(null);
  const value = picked ?? stored;
  return [
    value,
    (m) => {
      setPicked(m);
      storeModel(surface, m);
    },
  ];
}

export function ModelPicker({
  value,
  onChange,
  defaultModel,
  label = "Model",
}: {
  value: ModelId | "";
  onChange: (m: ModelId | "") => void;
  /** The counselor's own model, for the "default" option. */
  defaultModel?: string | null;
  label?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-muted" title="Which Claude model your counselor uses for this">
      {label}
      <select
        className="rounded-md border border-line bg-panel px-1.5 py-0.5 text-xs text-ink"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as ModelId | "")}
      >
        <option value="">Counselor&apos;s choice ({modelLabel(defaultModel)})</option>
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </label>
  );
}
