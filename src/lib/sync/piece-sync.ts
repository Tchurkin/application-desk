import * as Y from "yjs";
import { fromBase64, toBase64 } from "./base64";

/*
 * Saving one piece's Yjs document.
 *
 * Every screen appends only its own edits to an append-only log (piece_updates). Yjs
 * merges any set of updates, in any order and with duplicates, to the same document, so
 * there is no read-modify-write and no "last save wins".
 *
 * Edits are parked in local storage the moment they happen and removed only once the
 * server has them. A reload, a crash or leaving the piece a moment after typing replays
 * the parked edits on the next load instead of losing them.
 */

export const REMOTE = Symbol("remote");

export interface StoredUpdate {
  id: number;
  update: string;
  created_at: string;
}

export type PushResult = "ok" | "gone" | "retry";

export interface UpdateStore {
  load(pieceId: string): Promise<{ state: string; updates: StoredUpdate[] } | null>;
  push(pieceId: string, clientId: string, update: string): Promise<PushResult>;
  compact(pieceId: string, state: string, throughId: number, cutoff: string): Promise<void>;
}

export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

interface Parked {
  updates: string[];
  touched: number;
}

/** A parked list untouched this long belongs to a tab that is gone; adopt it. */
const ORPHAN_MS = 5_000;

export interface PieceSyncOptions {
  flushDelayMs?: number;
  /** Compact once the log holds more than this many rows. */
  compactAfter?: number;
  /** Only rows older than this are folded into the snapshot. */
  settleMs?: number;
  now?: () => number;
  onSaved?: () => void;
  onGone?: () => void;
  onStatus?: (s: SyncStatus) => void;
}

export type SyncStatus = "loading" | "saved" | "saving" | "offline" | "gone";

export class PieceSync {
  readonly doc: Y.Doc;
  private parkedKey: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;
  private retryMs = 500;
  private opts: Required<Omit<PieceSyncOptions, "onSaved" | "onGone" | "onStatus">> &
    Pick<PieceSyncOptions, "onSaved" | "onGone" | "onStatus">;

  constructor(
    private pieceId: string,
    private store: UpdateStore,
    private storage: KeyValue | null,
    private clientId: string,
    options: PieceSyncOptions = {},
    doc?: Y.Doc,
  ) {
    this.doc = doc ?? new Y.Doc();
    this.parkedKey = `desk:parked:${pieceId}:${clientId}`;
    this.opts = {
      flushDelayMs: 300,
      compactAfter: 100,
      settleMs: 60_000,
      now: () => Date.now(),
      ...options,
    };
  }

  private savedListeners = new Set<() => void>();

  /** Called each time everything typed so far is on the server. */
  addSavedListener(fn: () => void): () => void {
    this.savedListeners.add(fn);
    return () => this.savedListeners.delete(fn);
  }

  private status(s: SyncStatus) {
    this.opts.onStatus?.(s);
  }

  private read(key: string): Parked | null {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as Parked) : null;
    } catch {
      return null;
    }
  }

  private parked(): string[] {
    return this.read(this.parkedKey)?.updates ?? [];
  }

  private setParked(list: string[]) {
    try {
      if (list.length) {
        this.storage?.setItem(this.parkedKey, JSON.stringify({ updates: list, touched: this.opts.now() }));
      } else this.storage?.removeItem(this.parkedKey);
    } catch {
      // Storage full or blocked: the in-memory flush still runs.
    }
  }

  /** Take over edits parked by earlier tabs (or earlier loads of this one) for this piece. */
  private adoptOrphans(): string[] {
    if (!this.storage) return [];
    const prefix = `desk:parked:${this.pieceId}:`;
    const adopted: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && k.startsWith(prefix) && k !== this.parkedKey) keys.push(k);
    }
    for (const k of keys) {
      const p = this.read(k);
      if (!p) continue;
      if (this.opts.now() - p.touched < ORPHAN_MS) continue; // a live tab is still sending these
      adopted.push(...p.updates);
      try {
        this.storage.removeItem(k);
      } catch {}
    }
    if (adopted.length) this.setParked([...this.parked(), ...adopted]);
    return adopted;
  }

  private clearAllParked() {
    this.setParked([]);
    if (!this.storage) return;
    const prefix = `desk:parked:${this.pieceId}:`;
    const keys: string[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const k = this.storage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) {
      try {
        this.storage.removeItem(k);
      } catch {}
    }
  }

  private onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.stopped) return;
    this.setParked([...this.parked(), toBase64(update)]);
    this.status("saving");
    this.schedule(this.opts.flushDelayMs);
  };

  /** Load the saved document, replay anything parked, and start saving. */
  async start(): Promise<"ok" | "gone"> {
    this.status("loading");
    const loaded = await this.store.load(this.pieceId);
    if (!loaded) {
      this.clearAllParked();
      this.status("gone");
      return "gone";
    }
    this.adoptOrphans();
    Y.transact(
      this.doc,
      () => {
        if (loaded.state) Y.applyUpdate(this.doc, fromBase64(loaded.state), REMOTE);
        for (const u of loaded.updates) Y.applyUpdate(this.doc, fromBase64(u.update), REMOTE);
      },
      REMOTE,
    );
    const parked = this.parked();
    for (const u of parked) Y.applyUpdate(this.doc, fromBase64(u), REMOTE);
    this.doc.on("update", this.onUpdate);
    if (parked.length) this.schedule(0);
    else this.status("saved");
    void this.maybeCompact(loaded.updates);
    return "ok";
  }

  /** Apply an update that came from someone else. */
  applyRemote(update: Uint8Array) {
    Y.applyUpdate(this.doc, update, REMOTE);
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  /** Send everything parked. Safe to call at any time, including repeatedly. */
  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight.then(() => (this.parked().length ? this.flush() : undefined));
    const batch = this.parked();
    if (!batch.length) return Promise.resolve();
    const merged = toBase64(Y.mergeUpdates(batch.map(fromBase64)));
    this.inFlight = this.store
      .push(this.pieceId, this.clientId, merged)
      .catch((): PushResult => "retry")
      .then((result) => {
        this.inFlight = null;
        // A page that has gone away runs no more code; whatever it parked is the next load's job.
        if (this.stopped) return;
        if (result === "ok") {
          // Drop exactly what was sent, by identity; anything typed meanwhile stays parked.
          const sent = new Set(batch);
          this.setParked(this.parked().filter((u) => !sent.has(u)));
          this.retryMs = 500;
          if (this.parked().length) this.schedule(0);
          else {
            this.status("saved");
            this.opts.onSaved?.();
            this.savedListeners.forEach((f) => f());
          }
        } else if (result === "gone") {
          this.clearAllParked();
          this.stop();
          this.status("gone");
          this.opts.onGone?.();
        } else {
          this.status("offline");
          this.schedule(this.retryMs);
          this.retryMs = Math.min(this.retryMs * 2, 15_000);
        }
      });
    return this.inFlight;
  }

  private async maybeCompact(rows: StoredUpdate[]) {
    if (rows.length <= this.opts.compactAfter) return;
    const cutoff = new Date(this.opts.now() - this.opts.settleMs).toISOString();
    const settled = rows.filter((r) => r.created_at < cutoff);
    if (!settled.length) return;
    const throughId = Math.max(...settled.map((r) => r.id));
    // The snapshot may include newer edits too; Yjs ignores duplicates when they are merged again.
    const state = toBase64(Y.encodeStateAsUpdate(this.doc));
    try {
      await this.store.compact(this.pieceId, state, throughId, cutoff);
    } catch {
      // Compaction is an optimization; the log alone is always complete.
    }
  }

  /** Stop, and forget unsent edits: the piece is being deleted. */
  discard() {
    this.stop();
    this.clearAllParked();
  }

  /** Stop listening. Parked edits stay in storage for the next load. */
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.doc.off("update", this.onUpdate);
  }
}
