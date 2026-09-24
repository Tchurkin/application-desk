import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeskRequest } from "./requests";

/*
 * Live changes to a desk's requests: a question queued in another tab, the assistant's answer
 * arriving through the connector, a dismissal. Row-level security decides which rows reach
 * this browser, so only the desk's owner hears anything.
 */

export interface RequestFeed {
  onRow: (row: DeskRequest) => void;
  onDelete: (id: string) => void;
  /** Subscribed (first time or after a reconnect): fetch whatever was missed meanwhile. */
  onReady?: () => void;
}

/** Follow one desk's requests. Returns the unsubscribe. */
export function subscribeDeskRequests(supabase: SupabaseClient, deskId: string, feed: RequestFeed): () => void {
  // A topic of its own per subscriber: supabase-js hands back an existing channel for a reused
  // topic, and a second listener can't join a channel that already subscribed.
  const topic = `desk-requests:${deskId}:${Math.random().toString(36).slice(2, 10)}`;
  const filter = `desk_id=eq.${deskId}`;
  const channel = supabase
    .channel(topic)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "desk_requests", filter }, (p) =>
      feed.onRow(p.new as DeskRequest),
    )
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "desk_requests", filter }, (p) =>
      feed.onRow(p.new as DeskRequest),
    )
    // Deletes can't be filtered by column; the caller ignores ids it doesn't hold.
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "desk_requests" }, (p) => {
      const id = (p.old as { id?: string }).id;
      if (id) feed.onDelete(id);
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") feed.onReady?.();
    });
  return () => {
    void supabase.removeChannel(channel);
  };
}
