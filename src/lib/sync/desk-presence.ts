import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { colorFor } from "./realtime";

/*
 * Where everyone working on a desk is, for the Write page's list of colleges and pieces: a private
 * channel per desk ("desk:<id>") on which each open piece says who is on it. One channel per desk
 * serves the whole tab and stays open when the student moves to another piece: the new piece's
 * page mounts before the old one's cleanup has finished, and the client would hand back the
 * channel that was closing.
 */

export interface Here {
  /** Who: their account. */
  user: string;
  name: string;
  /** Theirs on every screen: worked out here from their account, never taken from what they send. */
  color: string;
  /** The piece they have open. */
  piece: string;
}

type Listener = (others: Here[]) => void;

/** How long after leaving the Write page this tab stops saying where it is. */
const LEAVE_MS = 1500;

class DeskPresence {
  private readonly channel: RealtimeChannel;
  private readonly key = Math.random().toString(36).slice(2, 12);
  private here: Here | null = null;
  private others: Here[] = [];
  private readonly listeners = new Set<Listener>();
  private leaving: ReturnType<typeof setTimeout> | null = null;
  private joined = false;

  constructor(supabase: SupabaseClient, deskId: string) {
    this.channel = supabase.channel(`desk:${deskId}`, { config: { private: true, presence: { key: this.key } } });
    this.channel
      .on("presence", { event: "sync" }, () => this.read())
      .subscribe((status) => {
        this.joined = status === "SUBSCRIBED";
        // Joined, or joined again after a dropped connection: say where we are.
        if (this.joined && this.here) void this.channel.track(this.here);
      });
  }

  private read() {
    const me = this.here?.user;
    const seen = new Set<string>();
    const others: Here[] = [];
    for (const [key, metas] of Object.entries(this.channel.presenceState<Here>())) {
      const h = metas.at(-1);
      if (key === this.key || !h || typeof h.user !== "string" || typeof h.piece !== "string" || h.user === me) continue;
      // Someone with two tabs on one piece shows on it once.
      const id = `${h.user}:${h.piece}`;
      if (seen.has(id)) continue;
      seen.add(id);
      others.push({ user: h.user, name: typeof h.name === "string" ? h.name.slice(0, 80) : "", color: colorFor(h.user), piece: h.piece });
    }
    this.others = others;
    this.listeners.forEach((f) => f(others));
  }

  /** This tab is on `here`: say so, and hear where everyone else is. Returns the way to stop. */
  attach(here: Here, listener: Listener): () => void {
    if (this.leaving) clearTimeout(this.leaving);
    this.leaving = null;
    this.here = here;
    if (this.joined) void this.channel.track(here);
    this.listeners.add(listener);
    listener(this.others);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size || this.leaving) return;
      this.leaving = setTimeout(() => {
        this.leaving = null;
        this.here = null;
        if (this.joined) void this.channel.untrack();
      }, LEAVE_MS);
    };
  }
}

const desks = new Map<string, DeskPresence>();

/** The tab's presence channel for a desk, made the first time it's needed. */
export function deskPresence(supabase: SupabaseClient, deskId: string): DeskPresence {
  let p = desks.get(deskId);
  if (!p) {
    p = new DeskPresence(supabase, deskId);
    desks.set(deskId, p);
  }
  return p;
}

/** Everyone else's pieces, by piece. */
export function byPiece(others: Here[]): Map<string, Here[]> {
  const out = new Map<string, Here[]>();
  for (const h of others) out.set(h.piece, [...(out.get(h.piece) ?? []), h]);
  return out;
}
