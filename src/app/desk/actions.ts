"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDesk } from "@/lib/supabase/server";
import { APP_SYSTEMS, PIECE_STATUSES, ROUNDS } from "@/lib/domain/colleges";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const date = (f: FormData, k: string) => s(f, k) || null;
const oneOf = <T extends string>(v: string, list: readonly { id: T }[], fallback: T): T =>
  (list.find((x) => x.id === v)?.id ?? fallback);

function collegeFields(f: FormData) {
  return {
    name: s(f, "name").slice(0, 200),
    app_system: oneOf(s(f, "app_system"), APP_SYSTEMS, "common_app"),
    round: oneOf(s(f, "round"), ROUNDS, "RD"),
    deadline: date(f, "deadline"),
    materials_deadline: date(f, "materials_deadline"),
    ai_policy: s(f, "ai_policy") === "no_drafting" ? "no_drafting" : "allowed",
    needs_letters: f.get("needs_letters") === "on",
  };
}

function fail(message: string): never {
  throw new Error(message);
}

export async function addCollege(f: FormData) {
  const { supabase, desk } = await requireDesk();
  const fields = collegeFields(f);
  if (!fields.name) fail("A college needs a name.");
  const { data, error } = await supabase.from("colleges").insert({ desk_id: desk.id, ...fields }).select("id").single();
  if (error) fail(error.message);
  redirect(`/desk/college/${data.id}`);
}

export async function updateCollege(id: string, f: FormData) {
  const { supabase } = await requireDesk();
  const fields = { ...collegeFields(f), research: s(f, "research") };
  const { error } = await supabase.from("colleges").update(fields).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/desk", "layout");
}

export async function deleteCollege(id: string) {
  const { supabase } = await requireDesk();
  const { error } = await supabase.from("colleges").delete().eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/desk", "layout");
  redirect("/desk");
}

export async function addPiece(collegeId: string | null, f: FormData) {
  const { supabase, desk } = await requireDesk();
  const limit = parseInt(s(f, "limit_value"), 10);
  const kind = s(f, "limit_kind");
  const { data, error } = await supabase
    .from("pieces")
    .insert({
      desk_id: desk.id,
      college_id: collegeId,
      title: s(f, "title").slice(0, 300) || "Untitled",
      prompt: s(f, "prompt"),
      limit_kind: kind === "chars" || kind === "none" ? kind : "words",
      limit_value: Number.isFinite(limit) && limit > 0 ? limit : null,
    })
    .select("id")
    .single();
  if (error) fail(error.message);
  redirect(`/desk/piece/${data.id}`);
}

export async function updatePieceMeta(
  id: string,
  patch: Partial<{
    title: string;
    prompt: string;
    limit_kind: string;
    limit_value: number | null;
    status: string;
    notes: string;
    college_id: string | null;
  }>,
) {
  const { supabase } = await requireDesk();
  const clean: Record<string, unknown> = {};
  if (patch.title !== undefined) clean.title = patch.title.slice(0, 300) || "Untitled";
  if (patch.prompt !== undefined) clean.prompt = patch.prompt;
  if (patch.notes !== undefined) clean.notes = patch.notes;
  if (patch.limit_kind !== undefined)
    clean.limit_kind = ["words", "chars", "none"].includes(patch.limit_kind) ? patch.limit_kind : "words";
  if (patch.limit_value !== undefined)
    clean.limit_value = patch.limit_value && patch.limit_value > 0 ? Math.floor(patch.limit_value) : null;
  if (patch.status !== undefined) clean.status = oneOf(patch.status, PIECE_STATUSES, "drafting");
  if (patch.college_id !== undefined) clean.college_id = patch.college_id;
  // update, never upsert: a deleted piece stays deleted.
  const { error } = await supabase.from("pieces").update(clean).eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/desk", "layout");
}

export async function deletePiece(id: string) {
  const { supabase } = await requireDesk();
  const { data: piece } = await supabase.from("pieces").select("college_id").eq("id", id).maybeSingle();
  // Versions and edit log cascade with the row.
  const { error } = await supabase.from("pieces").delete().eq("id", id);
  if (error) fail(error.message);
  revalidatePath("/desk", "layout");
  redirect(piece?.college_id ? `/desk/college/${piece.college_id}` : "/desk");
}

export async function updateProfile(f: FormData) {
  const { supabase, userId, desk } = await requireDesk();
  await supabase.from("profiles").update({ display_name: s(f, "display_name"), about: s(f, "about") }).eq("id", userId);
  await supabase.from("desks").update({ title: s(f, "title") || "My application desk" }).eq("id", desk.id);
  revalidatePath("/desk", "layout");
}

export async function deleteMyAccount(f: FormData) {
  if (s(f, "confirm") !== "delete") fail('Type "delete" to confirm.');
  const { supabase } = await requireDesk();
  const { error } = await supabase.rpc("delete_my_account");
  if (error) fail(error.message);
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
