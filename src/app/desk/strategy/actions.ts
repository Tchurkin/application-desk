"use server";
import { revalidatePath } from "next/cache";
import { parseStrategyForm } from "@/lib/strategy/form";
import { requireDesk } from "@/lib/supabase/server";

export interface StrategyResult {
  error?: string;
}

const UPDATE_NEEDED = "Run the latest database update to use this.";
const missingColumn = (code?: string) => code === "42703" || code === "PGRST204";

/**
 * The student's own strategy figures for one college. A chance they type becomes theirs
 * (source "student"); clearing it goes back to the published average rate.
 */
export async function updateStrategy(collegeId: string, f: FormData): Promise<StrategyResult> {
  const { supabase, desk } = await requireDesk();
  const { data: current, error: readError } = await supabase
    .from("colleges")
    .select("chance_percent")
    .eq("id", collegeId)
    .eq("desk_id", desk.id)
    .maybeSingle();
  if (readError) return { error: missingColumn(readError.code) ? UPDATE_NEEDED : readError.message };
  if (!current) return { error: "That college is no longer on your desk." };

  const parsed = parseStrategyForm(f, current);
  if ("error" in parsed) return { error: parsed.error };
  if (!Object.keys(parsed.patch).length) return {};

  const { error } = await supabase.from("colleges").update(parsed.patch).eq("id", collegeId).eq("desk_id", desk.id);
  if (error) return { error: missingColumn(error.code) ? UPDATE_NEEDED : error.message };
  revalidatePath("/desk", "layout");
  return {};
}
