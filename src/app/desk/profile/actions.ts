"use server";
import { revalidatePath } from "next/cache";
import { ACADEMICS_MAX, type Academics } from "@/lib/profile/academics";
import { requireDesk } from "@/lib/supabase/server";

export interface AcademicsState {
  saved?: boolean;
  error?: string;
}

const s = (f: FormData, k: keyof Academics) => String(f.get(k) ?? "").trim().slice(0, ACADEMICS_MAX[k]);

const KEYS = ["gpa", "test_scores", "intended_major", "class_rank", "coursework"] as const;

/**
 * The student's academics: context for odds estimates and writing help. Only the fields the
 * student changed are written (each field says what it was loaded with, as was_<field>), so
 * saving never undoes what the counselor stored meanwhile from a transcript. Class rank and
 * coursework (migration 20261006) are in the form only when the database has them.
 */
export async function updateAcademics(_prev: AcademicsState, f: FormData): Promise<AcademicsState> {
  const { supabase, userId } = await requireDesk();
  const fields: Partial<Academics> = {};
  for (const k of KEYS) {
    if (!f.has(k)) continue;
    const v = s(f, k);
    // A form without the loaded value (an older page) saves every field it has.
    const was = f.has(`was_${k}`) ? String(f.get(`was_${k}`) ?? "").trim().slice(0, ACADEMICS_MAX[k]) : null;
    if (v !== was) fields[k] = v;
  }
  if (!Object.keys(fields).length) return { saved: true };
  const { error } = await supabase.from("profiles").update(fields).eq("id", userId);
  if (error) {
    const behind = error.code === "42703" || error.code === "PGRST204";
    return { error: behind ? "Run the latest database update to use this." : error.message };
  }
  revalidatePath("/desk", "layout");
  return { saved: true };
}
