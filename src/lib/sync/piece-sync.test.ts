import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { fromBase64, toBase64 } from "./base64";
import { PieceSync, type KeyValue, type PushResult, type StoredUpdate, type UpdateStore } from "./piece-sync";

/* A seeded random so a failure can be replayed. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MemoryStorage implements KeyValue {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

/** The server: an append-only log with latency, refused writes and lost acknowledgements. */
class FakeStore implements UpdateStore {
  state = "";
  rows: StoredUpdate[] = [];
  deleted = false;
  private nextId = 1;
  constructor(
    private rand: () => number = Math.random,
    public latency = 0,
    /** Chance a write is refused outright. */
    public refuse = 0,
    /** Chance a write lands but the client is told it failed (so it sends it again). */
    public lostAck = 0,
  ) {}
  private wait() {
    return sleep(this.latency ? Math.floor(this.rand() * this.latency) : 0);
  }
  async load() {
    await this.wait();
    if (this.deleted) return null;
    return { state: this.state, updates: this.rows.map((r) => ({ ...r })) };
  }
  async push(_piece: string, _client: string, update: string): Promise<PushResult> {
    await this.wait();
    if (this.deleted) return "gone";
    if (this.rand() < this.refuse) return "retry";
    this.rows.push({ id: this.nextId++, update, created_at: new Date().toISOString() });
    if (this.rand() < this.lostAck) return "retry";
    return "ok";
  }
  async compact(_p: string, state: string, throughId: number, cutoff: string) {
    this.state = state;
    this.rows = this.rows.filter((r) => !(r.id <= throughId && r.created_at < cutoff));
  }
  /** The document a fresh visitor would see. */
  text(): string {
    const doc = new Y.Doc();
    if (this.state) Y.applyUpdate(doc, fromBase64(this.state));
    for (const r of this.rows) Y.applyUpdate(doc, fromBase64(r.update));
    return doc.getText("t").toString();
  }
}

function open(store: UpdateStore, storage: KeyValue, clientId: string, extra = {}) {
  return new PieceSync("p1", store, storage, clientId, { flushDelayMs: 2, ...extra });
}

async function settle(...syncs: PieceSync[]) {
  for (let i = 0; i < 50; i++) {
    await Promise.all(syncs.map((s) => s.flush()));
    await sleep(5);
  }
}

describe("PieceSync", () => {
  it("solo: every keystroke lands exactly once", async () => {
    const store = new FakeStore(rng(1), 6);
    const s = open(store, new MemoryStorage(), "a");
    await s.start();
    const t = s.doc.getText("t");
    const typed = "The quick brown fox jumps over the lazy dog. ".repeat(4);
    for (const ch of typed) {
      t.insert(t.length, ch);
      if (Math.random() < 0.3) await sleep(1);
    }
    await settle(s);
    expect(store.text()).toBe(typed);
  });

  it("reload mid-typing: nothing typed is lost, nothing doubled", async () => {
    for (const seed of [3, 7, 12345]) {
      const rand = rng(seed);
      const store = new FakeStore(rand, 40);
      const storage = new MemoryStorage();
      let expected = "";
      for (let round = 0; round < 6; round++) {
        const s = open(store, storage, "tab"); // same tab id survives a reload
        await s.start();
        const t = s.doc.getText("t");
        expect(t.toString()).toBe(expected);
        const n = 5 + Math.floor(rand() * 10);
        for (let i = 0; i < n; i++) {
          const ch = String.fromCharCode(97 + ((round * 7 + i) % 26));
          t.insert(t.length, ch);
          expected += ch;
          await sleep(Math.floor(rand() * 4));
        }
        s.stop(); // the page goes away, possibly with a write in flight
        await sleep(Math.floor(rand() * 60));
      }
      const final = open(store, storage, "tab");
      await final.start();
      await settle(final);
      expect(final.doc.getText("t").toString()).toBe(expected);
      expect(store.text()).toBe(expected);
    }
  }, 60_000);

  it("refused writes and lost acknowledgements still converge exactly once", async () => {
    const store = new FakeStore(rng(3), 20, 1 / 6, 1 / 6);
    const s = open(store, new MemoryStorage(), "a");
    await s.start();
    const t = s.doc.getText("t");
    let typed = "";
    for (let i = 0; i < 120; i++) {
      const ch = String.fromCharCode(65 + (i % 26));
      t.insert(t.length, ch);
      typed += ch;
      if (i % 7 === 0) await sleep(3);
    }
    for (let i = 0; i < 40; i++) {
      t.delete(Math.floor(t.length / 2), 1);
      typed = typed.slice(0, Math.floor(typed.length / 2)) + typed.slice(Math.floor(typed.length / 2) + 1);
    }
    await settle(s);
    expect(store.rows.length).toBeGreaterThan(0);
    expect(store.text()).toBe(typed);
  });

  it("two screens typing into the same store converge", async () => {
    const store = new FakeStore(rng(9), 10);
    const a = open(store, new MemoryStorage(), "a");
    const b = open(store, new MemoryStorage(), "b");
    await a.start();
    await b.start();
    const ta = a.doc.getText("t");
    const tb = b.doc.getText("t");
    for (let i = 0; i < 30; i++) {
      ta.insert(0, "a");
      tb.insert(tb.length, "b");
      await sleep(1);
    }
    await settle(a, b);
    const merged = store.text();
    expect(merged.split("a").length - 1).toBe(30);
    expect(merged.split("b").length - 1).toBe(30);
    // A fresh visitor and each screen, once it takes the other's edits, agree.
    for (const r of store.rows) {
      a.applyRemote(fromBase64(r.update));
      b.applyRemote(fromBase64(r.update));
    }
    expect(ta.toString()).toBe(merged);
    expect(tb.toString()).toBe(merged);
  });

  it("a deleted piece stays deleted: late writes are refused and parked edits dropped", async () => {
    const store = new FakeStore(rng(4), 5);
    const storage = new MemoryStorage();
    let gone = false;
    const s = open(store, storage, "a", { onGone: () => (gone = true) });
    await s.start();
    s.doc.getText("t").insert(0, "hello");
    await settle(s);
    store.deleted = true;
    store.rows = [];
    s.doc.getText("t").insert(5, " world");
    await settle(s);
    expect(gone).toBe(true);
    expect(store.rows).toHaveLength(0);
    expect(storage.length).toBe(0);
    const again = open(store, storage, "a");
    expect(await again.start()).toBe("gone");
  });

  it("an empty piece saves and reloads", async () => {
    const store = new FakeStore();
    const s = open(store, new MemoryStorage(), "a");
    await s.start();
    await settle(s);
    expect(store.rows).toHaveLength(0);
    const r = open(store, new MemoryStorage(), "b");
    await r.start();
    expect(r.doc.getText("t").toString()).toBe("");
  });

  it("adopts edits parked by a tab that closed, but not from a live one", async () => {
    let now = 1_000_000;
    const store = new FakeStore();
    store.refuse = 1; // nothing gets through while the first tab is open
    const storage = new MemoryStorage();
    const closed = open(store, storage, "old", { now: () => now });
    await closed.start();
    closed.doc.getText("t").insert(0, "draft");
    await sleep(10);
    closed.stop();

    const tooSoon = open(store, storage, "new1", { now: () => now + 1000 });
    await tooSoon.start();
    expect(tooSoon.doc.getText("t").toString()).toBe("");
    tooSoon.stop();
    store.refuse = 0;

    now += 10_000;
    const later = open(store, storage, "new2", { now: () => now });
    await later.start();
    await settle(later);
    expect(later.doc.getText("t").toString()).toBe("draft");
    expect(store.text()).toBe("draft");
  });

  it("compaction keeps rows that are too new to fold, and the document is unchanged", async () => {
    const store = new FakeStore();
    const s = open(store, new MemoryStorage(), "a");
    await s.start();
    const t = s.doc.getText("t");
    for (let i = 0; i < 30; i++) {
      t.insert(t.length, "x");
      await s.flush();
    }
    // Age the first 20 rows past the settle time.
    const old = new Date(Date.now() - 120_000).toISOString();
    store.rows.slice(0, 20).forEach((r) => (r.created_at = old));
    const before = store.text();
    const c = open(store, new MemoryStorage(), "b", { compactAfter: 10 });
    await c.start();
    await sleep(5);
    expect(store.rows).toHaveLength(10);
    expect(store.state).not.toBe("");
    expect(store.text()).toBe(before);
    // State round-trips through base64.
    expect(toBase64(fromBase64(store.state))).toBe(store.state);
  });
});
