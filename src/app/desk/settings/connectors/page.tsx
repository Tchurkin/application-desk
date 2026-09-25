import Link from "next/link";
import { ConfirmButton } from "@/components/confirm-button";
import { asEssayAccess } from "@/lib/domain/share";
import { requireDesk } from "@/lib/supabase/server";
import { revokeConnectorLink } from "../../connector-actions";
import { ConnectorCreator, ConnectorPermissions, ConnectorStatus } from "../connector-creator";
import { SettingsHeader } from "../settings-header";

interface ConnectorRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  essay_access?: string;
  can_manage?: boolean;
  counselor_at?: string | null;
}

export default async function ConnectorSettingsPage() {
  const { supabase, desk } = await requireDesk();
  const connectorQuery = (cols: string) =>
    supabase.from("connector_links").select(cols).eq("desk_id", desk.id).is("revoked_at", null).order("created_at", { ascending: false });
  const result = await connectorQuery("id, label, created_at, last_used_at, essay_access, can_manage, counselor_at");
  // A database before migration 20261001 has no permissions or counselor yet.
  const all = (result.error ? (await connectorQuery("id, label, created_at, last_used_at")).data : result.data) as ConnectorRow[] | null;
  const permissionsReady = !result.error;
  // The counselor has a page of its own.
  const connectors = (all ?? []).filter((c) => !c.counselor_at);

  return (
    <>
      <SettingsHeader title="Claude & ChatGPT">
        <p>
          Let Claude or ChatGPT work on your desk, on your own plan with no extra cost. Ask for feedback and its edits arrive here as
          suggestions you accept or decline. Ask it to draft or rewrite and it writes straight into your pieces, and it can set up
          your colleges with every prompt and word limit. You decide what each link may do. Before it changes a piece directly,
          your current text is saved in that piece&apos;s History, so you can always restore it.
        </p>
        <p>
          Anyone with a connector link can read and change your desk, so keep it private and revoke it when you&apos;re done. For
          privacy, turn off model training on your chats in Claude or ChatGPT settings. To have answers arrive on their own, set up
          your{" "}
          <Link href="/desk/settings/counselor" className="underline underline-offset-2">
            counselor
          </Link>{" "}
          instead.
        </p>
      </SettingsHeader>
      <section className="card px-4 py-4" aria-label="New connector link">
        <ConnectorCreator />
      </section>
      {connectors.length > 0 && (
        <ul className="mt-6 flex flex-col gap-2" aria-label="Connector links">
          {connectors.map((c) => (
            <li key={c.id} className="card px-3 py-2 text-sm" data-testid="connector-link">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="font-medium">{c.label}</span>
                  <ConnectorStatus counselorAt={null} lastUsedAt={c.last_used_at} />
                </span>
                <ConfirmButton
                  label="Revoke"
                  confirmLabel="Revoke"
                  question={`Disconnect ${c.label}?`}
                  onConfirm={revokeConnectorLink.bind(null, c.id)}
                />
              </div>
              {permissionsReady && (
                <ConnectorPermissions id={c.id} label={c.label} essays={asEssayAccess(c.essay_access)} manage={c.can_manage !== false} />
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
