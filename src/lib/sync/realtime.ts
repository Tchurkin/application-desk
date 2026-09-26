import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import type * as Y from "yjs";
import type { Suggestion } from "@/lib/suggest/store";
import { fromBase64, toBase64 } from "./base64";

/*
 * One private channel per piece ("piece:<id>"): new rows of the edit log and suggestions
 * (delivered only to people the database lets read them), plus everyone's cursor and name.
 * After any reconnect, onReconnect lets the caller fetch whatever it missed.
 */

export interface Person {
  name: string;
  color: string;
  role: "owner" | "edit" | "suggest" | "view";
}

export interface PieceChannelHandlers {
  onUpdateRow: (row: { id: number; update: string }) => void;
  onSuggestion: (row: Suggestion) => void;
  onSuggestionDeleted: (id: string) => void;
  onReconnect: () => void;
  onPeople?: (people: Person[]) => void;
}

const COLORS = ["#2f7d6b", "#b5562b", "#6b4fa3", "#2b6cb0", "#a3316b", "#7a6a1f"];
export function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

export class PieceChannel {
  readonly awareness: Awareness;
  private channel: RealtimeChannel | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(
    private supabase: SupabaseClient,
    private pieceId: string,
    doc: Y.Doc,
    private me: Person,
    private handlers: PieceChannelHandlers,
  ) {
    this.awareness = new Awareness(doc);
    this.awareness.setLocalStateField("user", { name: me.name, color: me.color, role: me.role });
  }

  private sendAwareness(clients: number[]) {
    if (!this.channel || !clients.length) return;
    const update = toBase64(encodeAwarenessUpdate(this.awareness, clients));
    void this.channel.send({ type: "broadcast", event: "aw", payload: { u: update } });
  }

  private onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === "local") this.sendAwareness([...added, ...updated, ...removed]);
    this.reportPeople();
  };

  private reportPeople() {
    if (!this.handlers.onPeople) return;
    const people: Person[] = [];
    this.awareness.getStates().forEach((st, client) => {
      if (client === this.awareness.clientID) return;
      const u = (st as { user?: Person }).user;
      if (!u || typeof u.name !== "string") return;
      // Shown as a background: a plain color only, never something that makes the browser fetch.
      const color = typeof u.color === "string" && /^#[0-9a-f]{6}$/i.test(u.color) ? u.color : COLORS[0];
      people.push({ name: u.name.slice(0, 80), color, role: u.role });
    });
    this.handlers.onPeople(people);
  }

  start() {
    const filter = `piece_id=eq.${this.pieceId}`;
    this.channel = this.supabase
      .channel(`piece:${this.pieceId}`, { config: { private: true, broadcast: { self: false } } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "piece_updates", filter }, (p) =>
        this.handlers.onUpdateRow(p.new as { id: number; update: string }),
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "suggestions", filter }, (p) =>
        this.handlers.onSuggestion(p.new as Suggestion),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "suggestions", filter }, (p) =>
        this.handlers.onSuggestion(p.new as Suggestion),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "suggestions" }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) this.handlers.onSuggestionDeleted(id);
      })
      .on("broadcast", { event: "aw" }, ({ payload }) => {
        applyAwarenessUpdate(this.awareness, fromBase64((payload as { u: string }).u), "remote");
      })
      .on("broadcast", { event: "hello" }, () => this.sendAwareness([this.awareness.clientID]))
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // First connection or a reconnect: fetch anything missed since loading, and say who we are.
        this.handlers.onReconnect();
        this.sendAwareness([this.awareness.clientID]);
        void this.channel?.send({ type: "broadcast", event: "hello", payload: {} });
      });
    this.awareness.on("update", this.onAwareness);
    // Awareness forgets people it hasn't heard from in 30s; keep ours alive.
    this.heartbeat = setInterval(() => this.sendAwareness([this.awareness.clientID]), 15_000);
  }

  stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    removeAwarenessStates(this.awareness, [this.awareness.clientID], "local");
    this.awareness.off("update", this.onAwareness);
    if (this.channel) void this.supabase.removeChannel(this.channel);
    this.channel = null;
    this.awareness.destroy();
  }
}
