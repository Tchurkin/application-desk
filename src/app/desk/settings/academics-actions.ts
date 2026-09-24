"use server";
import { revalidatePath } from "next/cache";
import { requireDesk } from "@/lib/supabase/server";

export interface AcademicsState {
  saved?: boolean;
  error?: string;
}

const s = (f: FormData, k: string, max: number) => String(f.get(k) ?? "").trim().slice(0, max);

/** The student's GPA, test scores and intended major: context for odds estimates and writing help. */
export async function updateAcademics(_prev: AcademicsState, f: FormData): Promise<AcademicsState> {
  const { supabase, userId } = await requireDesk();
  const { error } = await supabase
    .from("profiles")
    .update({ gpa: s(f, "gpa", 40), test_scores: s(f, "test_scores", 200), intended_major: s(f, "intended_major", 200) })
    .eq("id", userId);
  if (error) {
    const behind = error.code === "42703" || error.code === "PGRST204";
    return { error: behind ? "Run the latest database update to use this." : error.message };
  }
  revalidatePath("/desk", "layout");
  return { saved: true };
}
