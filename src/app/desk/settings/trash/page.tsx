import { bridgeMissing } from "@/lib/bridge/requests";
import { requireDesk } from "@/lib/supabase/server";
import { SettingsHeader } from "../settings-header";
import { TrashList, type TrashItem } from "./trash-list";

/** How long the Trash keeps things (the database clears older ones). */
const KEEP_DAYS = 30;
const DAY = 86_400_000;

export default async function TrashPage() {
  const { supabase, desk } = await requireDesk();
  // The server's clock, once per request: what has expired, and how long the rest have left.
  const now = new Date().getTime();
  await supabase
    .from("trash")
    .delete()
    .eq("desk_id", desk.id)
    .lt("deleted_at", new Date(now - KEEP_DAYS * DAY).toISOString());
  const { data, error } = await supabase
    .from("trash")
    .select("id, kind, title, detail, deleted_by, deleted_at")
    .eq("desk_id", desk.id)
    .order("deleted_at", { ascending: false });
  const items: TrashItem[] = ((data ?? []) as Omit<TrashItem, "daysLeft">[])
    .map((t) => ({ ...t, daysLeft: KEEP_DAYS - Math.floor((now - Date.parse(t.deleted_at)) / DAY) }))
    .filter((t) => t.daysLeft > 0);

  return (
    <>
      <SettingsHeader title="Trash">
        <p>
          Pieces and colleges you delete, or Claude or ChatGPT deletes, wait here for {KEEP_DAYS} days with their history, notes,
          suggestions and Ask threads. Restore one and it comes back just as it was.
        </p>
      </SettingsHeader>
      {error ? (
        <p className="text-sm text-muted">
          {bridgeMissing(error) ? "Run the latest database update to use the Trash." : `Couldn't open the Trash (${error.message}).`}
        </p>
      ) : (
        <TrashList items={items} />
      )}
    </>
  );
}
