import { ConfirmButton } from "@/components/confirm-button";
import { asShareRole, shareRoleLabel } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";
import { removeMember, revokeShareLink } from "../../share-actions";
import { SettingsHeader } from "../settings-header";
import { ShareCreator, ShareRoleSelect } from "../share-creator";
import { DeskSharing } from "./desk-sharing";

/** A name to start from: the student's first name, made plain, and a few digits. */
function suggestName(from: string, id: string): string {
  const base = from.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "desk";
  const digits = parseInt(id.replace(/-/g, "").slice(0, 6), 16) % 1000;
  return `${base.length < 3 ? "desk" : base}-${String(digits).padStart(3, "0")}`;
}

type LinkRow = { id: string; role: string; label: string; created_at: string; via_password?: boolean };

export default async function SharingSettingsPage() {
  const { supabase, desk, userId } = await requireDesk();
  const links = (cols: string) =>
    supabase.from("share_links").select(cols).eq("desk_id", desk.id).is("revoked_at", null).order("created_at", { ascending: false });
  const [withFlag, members, password, profile, guesses] = await Promise.all([
    links("id, role, label, created_at, via_password"),
    supabase.from("desk_members").select("user_id, display_name, link_id, joined_at").eq("desk_id", desk.id).order("joined_at"),
    // Only the student can read this row: the name sits here, not on the desk its members can read.
    supabase.from("share_passwords").select("desk_id, share_name").eq("desk_id", desk.id).maybeSingle(),
    supabase.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    supabase.rpc("desk_share_guesses", { d: desk.id }),
  ]);
  // A database before migration 20261013 has no desk names yet: links only.
  const behind = !!password.error || !!withFlag.error;
  const all = ((behind ? (await links("id, role, label, created_at")).data : withFlag.data) ?? []) as unknown as LinkRow[];
  const byPassword = all.find((l) => l.via_password) ?? null;
  const perPerson = all.filter((l) => !l.via_password);
  const shareName = (password.data as { share_name?: string | null } | null)?.share_name ?? null;
  const on = !behind && !!shareName && !!byPassword;
  const people = members.data ?? [];
  const wrongTries = on && typeof guesses.data === "number" ? guesses.data : 0;

  return (
    <>
      <SettingsHeader title="Sharing">
        <p>
          Let a parent or mentor into your desk: give it a name and a password, and tell them both. They open it from the home page
          and type their name. Choose whether they can read your desk, suggest edits that you accept or decline, or edit your text
          directly (and switch to suggesting when they want you to decide).
        </p>
      </SettingsHeader>

      <section className="card mb-6 px-4 py-4" aria-labelledby="desk-sharing-h">
        <h3 id="desk-sharing-h" className="mb-2 font-medium">
          Desk name and password
        </h3>
        {wrongTries >= 20 && (
          <p role="alert" className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {wrongTries} wrong passwords have been tried on your desk name today. If that isn&apos;t someone you know mistyping,
            change the desk name and password below and give the new ones only to people you trust.
          </p>
        )}
        {behind ? (
          <p className="text-sm text-muted">Run the latest database update (supabase/setup.sql) to share with a desk name and password.</p>
        ) : (
          <DeskSharing
            name={shareName}
            suggested={suggestName((profile.data?.display_name as string | undefined) ?? "", desk.id)}
            on={on}
            role={asShareRole(byPassword?.role ?? "suggest")}
          />
        )}
      </section>

      <section className="mb-6" aria-labelledby="people-h">
        <h3 id="people-h" className="mb-2 font-medium">
          People who have joined
        </h3>
        {people.length === 0 ? (
          <p className="text-sm text-muted">Nobody yet.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="People who have joined">
            {people.map((m) => {
              const link = all.find((l) => l.id === m.link_id);
              const how = !link
                ? "their link was turned off"
                : link.via_password
                  ? `with the password · ${shareRoleLabel(link.role)}`
                  : `through ${link.label ? `the link for ${link.label}` : "a link"} · ${shareRoleLabel(link.role)}`;
              return (
                <li key={m.user_id} className="card flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{m.display_name}</span>
                    <span className="block text-xs text-muted">{how}</span>
                  </span>
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Remove"
                    question={
                      link && !link.via_password
                        ? `Remove ${m.display_name} from your desk? They can come back through their link until you revoke it (under Links for one person).`
                        : `Remove ${m.display_name} from your desk? If they know your desk name and password they can come back: change the password to keep them out.`
                    }
                    onConfirm={removeMember.bind(null, m.user_id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <details className="card px-4 py-3" data-testid="share-links-fold" open={perPerson.length > 0}>
        <summary className="cursor-pointer font-medium">Links for one person</summary>
        <p className="mt-2 mb-3 text-sm text-muted">
          Or give someone a link of their own instead: it opens your desk without the desk name, and asks for your password if
          you&apos;ve set one. Revoking it cuts off whoever came in through it (though anyone who also knows your desk name and
          password can still use those).
        </p>
        <div aria-label="New share link">
          <ShareCreator />
        </div>
        {perPerson.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2" aria-label="Share links">
            {perPerson.map((l) => {
              const joined = people.filter((m) => m.link_id === l.id);
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
      </details>
    </>
  );
}
