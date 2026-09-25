import { ConfirmButton } from "@/components/confirm-button";
import { asShareRole } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";
import { revokeShareLink } from "../../share-actions";
import { SettingsHeader } from "../settings-header";
import { ShareCreator, ShareRoleSelect } from "../share-creator";

export default async function SharingSettingsPage() {
  const { supabase, desk } = await requireDesk();
  const [{ data: links }, { data: members }] = await Promise.all([
    supabase
      .from("share_links")
      .select("id, role, label, created_at")
      .eq("desk_id", desk.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("desk_members").select("user_id, display_name, link_id, joined_at").eq("desk_id", desk.id),
  ]);

  return (
    <>
      <SettingsHeader title="Sharing">
        <p>
          Give a parent or mentor a link. They open it, type their name, and can read your desk; suggest edits that you accept or
          decline; or edit your text directly (and switch to suggesting when they want you to decide). Change what a link can do
          at any time, and revoke it to cut off everyone who joined through it.
        </p>
      </SettingsHeader>
      <section className="card px-4 py-4" aria-label="New share link">
        <ShareCreator />
      </section>
      {links && links.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2" aria-label="Share links">
          {links.map((l) => {
            const joined = (members ?? []).filter((m) => m.link_id === l.id);
            return (
              <li key={l.id} className="card flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{l.label || "Untitled link"}</span>
                  <span className="text-muted"> · </span>
                  <ShareRoleSelect id={l.id} role={asShareRole(l.role)} label={l.label} />
                  <span className="block text-xs text-muted">
                    {joined.length ? `Joined: ${joined.map((m) => m.display_name).join(", ")}` : "Nobody has joined yet"}
                  </span>
                </span>
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Revoke"
                  question={`Revoke this link${joined.length ? ` and cut off ${joined.map((m) => m.display_name).join(", ")}` : ""}?`}
                  onConfirm={revokeShareLink.bind(null, l.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
