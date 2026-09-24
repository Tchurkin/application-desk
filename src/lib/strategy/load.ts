import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUEST_COLS, type Assistant, type DeskRequest } from "@/lib/bridge/requests";
import type { CollegeRow } from "@/lib/data/queries";
import { buildStrategy, type Baseline, type Strategy } from "./bands";
import { catalogCandidates, matchCollege, type CatalogEntry } from "./catalog";

/*
 * Everything the Strategy page shows, loaded on the server. Each piece degrades on its own when
 * the database is a migration behind: colleges still list (as Unrated or by published rate), and
 * the page says which features need the update.
 */

export interface Academics {
  gpa: string;
  test_scores: string;
  intended_major: string;
}

/** A college as the page's client components receive it: row fields plus its catalog baseline. */
export type StrategyCollegeView = CollegeRow & {
  baseline: (Baseline & { id: number; name: string }) | null;
  /** Catalog colleges sharing the name, so the student can pick theirs. Empty when the name is unique. */
  candidates: { id: number; label: string }[];
};

export interface StrategyData {
  strategy: Strategy<StrategyCollegeView>;
  /** The colleges table has the strategy columns (migration 20260928). */
  editable: boolean;
  academics: Academics | null;
  /** The desk_requests table exists. */
  bridge: boolean;
  /** Assistants with a live connector link. */
  assistants: Assistant[];
  pendingOdds: DeskRequest | null;
  lastOdds: DeskRequest | null;
}

function baselineOf(e: CatalogEntry | null): StrategyCollegeView["baseline"] {
  return e ? { id: e.id, name: e.name, rate: e.rate, sat: e.sat, act: e.act, cost: e.cost, net: e.net } : null;
}

export async function loadStrategy(supabase: SupabaseClient, deskId: string, userId: string): Promise<StrategyData> {
  const [colleges, probe, profile, requests, links] = await Promise.all([
    // "*" so strategy columns come back when the database has them, and nothing breaks when not.
    supabase.from("colleges").select("*").eq("desk_id", deskId).order("name"),
    supabase.from("colleges").select("chance_percent").eq("desk_id", deskId).limit(1),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase
      .from("desk_requests")
      .select(REQUEST_COLS)
      .eq("desk_id", deskId)
      .eq("kind", "odds")
      .in("status", ["pending", "answered"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("connector_links").select("label").eq("desk_id", deskId).is("revoked_at", null),
  ]);
  if (colleges.error) throw colleges.error;

  const rows = (colleges.data ?? []) as CollegeRow[];
  const views: StrategyCollegeView[] = rows.map((c) => {
    const many = catalogCandidates(c.name);
    return {
      ...c,
      baseline: baselineOf(matchCollege(c.name, c.scorecard_id)),
      candidates: many.length > 1 ? many.map((m) => ({ id: m.id, label: `${m.name} (${m.city}, ${m.state})` })) : [],
    };
  });

  const p = profile.data as Partial<Academics> | null;
  const academics = p && "gpa" in p ? { gpa: p.gpa ?? "", test_scores: p.test_scores ?? "", intended_major: p.intended_major ?? "" } : null;

  const reqs = (requests.data ?? []) as unknown as DeskRequest[];
  const labels = new Set((links.data ?? []).map((l: { label: string }) => l.label.toLowerCase()));
  const assistants = (["claude", "chatgpt"] as const).filter((a) => labels.has(a));

  return {
    strategy: buildStrategy(views, (c) => c.baseline),
    // The probe fails with "undefined column" on a database a migration behind.
    editable: !probe.error,
    academics,
    bridge: !requests.error,
    assistants,
    pendingOdds: reqs.find((r) => r.status === "pending") ?? null,
    lastOdds: reqs.find((r) => r.status === "answered") ?? null,
  };
}
