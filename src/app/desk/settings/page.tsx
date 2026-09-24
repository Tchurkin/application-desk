import { ConfirmButton } from "@/components/confirm-button";
import { requireDesk } from "@/lib/supabase/server";
import { deleteMyAccount, updateProfile } from "../actions";
import { revokeConnectorLink } from "../connector-actions";
import { revokeShareLink } from "../share-actions";
import { asEssayAccess, asShareRole } from "@/lib/domain/share";
import { AcademicsForm } from "./academics-form";
import { ConnectorCreator, ConnectorPermissions, ConnectorStatus } from "./connector-creator";
import { CounselorSetup } from "./counselor-setup";
import { ShareCreator, ShareRoleSelect } from "./share-creator";

interface ConnectorRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  essay_access?: string;
  can_manage?: boolean;
  counselor_at?: string | null;
}


export default async function SettingsPage() {
  const { supabase, userId, desk } = await requireDesk();
  const connectorQuery = (cols: string) =>
    supabase.from("connector_links").select(cols).eq("desk_id", desk.id).is("revoked_at", null).order("created_at", { ascending: false });
  const [{ data: profile }, { data: links }, { data: members }, connectorResult] = await Promise.all([
    // "*" so the academic fields (migration 20260928) come back when the database has them.
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase
      .from("share_links")
      .select("id, role, label, created_at")
      .eq("desk_id", desk.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("desk_members").select("user_id, display_name, link_id, joined_at").eq("desk_id", desk.id),
    connectorQuery("id, label, created_at, last_used_at, essay_access, can_manage, counselor_at"),
  ]);
  // A database before migration 20261001 has no permissions or counselor yet.
  const connectors = (
    connectorResult.error ? (await connectorQuery("id, label, created_at, last_used_at")).data : connectorResult.data
  ) as ConnectorRow[] | null;
  const permissionsReady = !connectorResult.error;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl">Settings</h1>

      <form action={updateProfile} className="card mb-10 flex flex-col gap-4 px-4 py-4">
        <div>
          <label className="label" htmlFor="title">Desk name</label>
          <input className="field" id="title" name="title" defaultValue={desk.title} />
        </div>
        <div>
          <label className="label" htmlFor="display_name">Your first name</label>
          <input className="field" id="display_name" name="display_name" defaultValue={profile?.display_name ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="about">About you</label>
          <textarea
            className="field"
            id="about"
            name="about"
            rows={6}
            defaultValue={profile?.about ?? ""}
            placeholder="Activities, interests, what you want to study. Only used as context if you turn on the counselor."
          />
        </div>
        <div><button className="btn btn-primary" type="submit">Save</button></div>
      </form>

      <section className="card mb-10 px-4 py-4" aria-labelledby="academics">
        <h2 id="academics" className="mb-1 font-serif text-xl">Academic profile</h2>
        <p className="mb-4 text-sm text-muted">
          Your grades, scores and intended major. Claude or ChatGPT uses them, through your connector, to estimate your admission
          odds on the Strategy page. Every field is optional; write them however you like.
        </p>
        {profile && "gpa" in profile ? (
          <AcademicsForm gpa={profile.gpa ?? ""} testScores={profile.test_scores ?? ""} intendedMajor={profile.intended_major ?? ""} />
        ) : (
          <p className="text-sm text-muted">Run the latest database update to use this.</p>
        )}
      </section>

      <section className="card mb-10 px-4 py-4" aria-labelledby="sharing">
        <h2 id="sharing" className="mb-1 font-serif text-xl">Sharing</h2>
        <p className="mb-4 text-sm text-muted">
          Give a parent or mentor a link. They open it, type their name, and can read your desk; suggest edits that you accept
          or decline; or edit your text directly (and switch to suggesting when they want you to decide). Change what a link
          can do at any time, and revoke it to cut off everyone who joined through it.
        </p>
        <ShareCreator />
        {links && links.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2" aria-label="Share links">
            {links.map((l) => {
              const joined = (members ?? []).filter((m) => m.link_id === l.id);
              return (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm">
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
      </section>

      <section className="card mb-10 px-4 py-4" aria-labelledby="connect">
        <h2 id="connect" className="mb-1 font-serif text-xl">Connect Claude or ChatGPT</h2>
        <p className="mb-2 text-sm text-muted">
          Let Claude or ChatGPT work on your desk, on your own plan with no extra cost. Ask for feedback and its edits arrive
          here as suggestions you accept or decline. Ask it to draft or rewrite and it writes straight into your pieces, and it
          can set up your colleges with every prompt and word limit. You decide what each link may do. Before it changes a
          piece directly, your current text is saved in that piece&apos;s History, so you can always restore it.
        </p>
        <p className="mb-4 text-sm text-muted">
          Anyone with a connector link can read and change your desk, so keep it private and revoke it when you&apos;re done.
          For privacy, turn off model training on your chats in Claude or ChatGPT settings.
        </p>
        <ConnectorCreator />
        {connectors && connectors.length > 0 && (
          <ul className="mt-6 flex flex-col gap-2" aria-label="Connector links">
            {connectors.map((c) => {
              const counselor = !!c.counselor_at;
              return (
                <li key={c.id} className="rounded-md border border-line px-3 py-2 text-sm" data-testid="connector-link">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{counselor ? `${c.label} · counselor on your computer` : c.label}</span>
                      <ConnectorStatus counselorAt={c.counselor_at ?? null} lastUsedAt={c.last_used_at} />
                    </span>
                    <ConfirmButton
                      label="Revoke"
                      confirmLabel="Revoke"
                      question={counselor ? "Turn off the counselor and disconnect it?" : `Disconnect ${c.label}?`}
                      onConfirm={revokeConnectorLink.bind(null, c.id)}
                    />
                  </div>
                  {permissionsReady && (
                    <ConnectorPermissions
                      id={c.id}
                      label={c.label}
                      essays={asEssayAccess(c.essay_access)}
                      manage={c.can_manage !== false}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card mb-10 px-4 py-4" aria-labelledby="counselor">
        <h2 id="counselor" className="mb-1 font-serif text-xl">Your counselor</h2>
        <p className="mb-2 text-sm text-muted">
          Make Claude your counselor on this computer, so everything you ask on your desk (Ask, Polish, odds, the Profile
          interview) gets answered on its own, with no chat or terminal to open. It&apos;s one download and a double-click: it
          runs hidden, starts whenever you sign in, and wakes Claude only when you ask something. It remembers what you&apos;ve
          told it from one question to the next.
        </p>
        <p className="mb-4 text-sm text-muted">
          It uses your own Claude plan through Claude Code, which needs to be installed and signed in once
          (claude.com/claude-code). Revoke its link above to turn it off.
        </p>
        <CounselorSetup />
      </section>

      <section className="rounded-lg border border-danger px-4 py-4">
        <h2 className="mb-2 font-medium text-danger">Delete my data</h2>
        <p className="mb-3 text-sm">
          Permanently deletes your account, your desk, every college and piece, and all version history. This can&apos;t be
          undone.
        </p>
        <form action={deleteMyAccount} className="flex flex-wrap items-center gap-2">
          <input className="field max-w-48" name="confirm" placeholder='Type "delete"' aria-label='Type "delete" to confirm' autoComplete="off" />
          <button className="btn btn-danger" type="submit">Delete everything</button>
        </form>
      </section>
    </main>
  );
}
