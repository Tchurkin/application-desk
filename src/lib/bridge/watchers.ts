import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Who is answering the desk right now: a Claude or ChatGPT chat running watch_desk, or the
 * counselor on the student's computer (see src/lib/counselor/installer.ts). Both check in on the
 * desk's connector link; the website reads when they last did.
 */

export interface Connector {
  label: string;
  last_used_at: string | null;
  /** When a chat (watch_desk) or the counselor last checked the desk (migration 20260929). */
  watched_at?: string | null;
  /** When the counselor on the student's computer last checked in (migration 20261001). */
  counselor_at?: string | null;
}

/** What the student says once in their open Claude/ChatGPT chat. */
export const WATCH_PHRASE = "Watch my Application Desk";
/** Watchers check in at least every ~45s; allow for a slow answer in between. */
export const WATCH_FRESH_MS = 120_000;

const fresh = (ts: string | null | undefined, now: number) => !!ts && now - Date.parse(ts) < WATCH_FRESH_MS;

/** The counselor or chat watching the desk right now, if any; a counselor first. */
export function watcher(connectors: Connector[] | null, now: number): Connector | null {
  if (!connectors) return null;
  return connectors.find((c) => fresh(c.counselor_at, now)) ?? connectors.find((c) => fresh(c.watched_at, now)) ?? null;
}

export function isCounselor(c: Connector | null, now: number): boolean {
  return !!c && fresh(c.counselor_at, now);
}

const COLUMNS = ["label, last_used_at, watched_at, counselor_at", "label, last_used_at, watched_at", "label, last_used_at"];

/** The desk's live connector links; null when they can't be read (then nothing is assumed). */
export async function fetchConnectors(supabase: SupabaseClient, deskId: string): Promise<Connector[] | null> {
  for (const cols of COLUMNS) {
    const { data, error } = await supabase.from("connector_links").select(cols).eq("desk_id", deskId).is("revoked_at", null);
    if (!error) return (data ?? []) as unknown as Connector[];
    // A database a migration behind has fewer columns: ask for fewer.
    if (error.code !== "42703" && error.code !== "PGRST204") return null;
  }
  return null;
}
