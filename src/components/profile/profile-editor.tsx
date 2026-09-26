"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import { FormattedTextarea } from "@/components/formatted-textarea";
import { mergeSection, moveSection, nextSort, removeSection, SECTION_COLS, sortSections, type SectionRow } from "@/lib/profile/sections";
import { supabaseBrowser } from "@/lib/supabase/client";

/*
 * The Profile page's sections: the student writes and arranges them, and Claude adds and
 * rewrites them through the connector (for example during an interview). Changes from either
 * side show up live; a section being typed in keeps the student's words until they leave it.
 */

const SAVE_MS = 600;

export function ProfileEditor({ deskId, initial }: { deskId: string; initial: SectionRow[] }) {
  const supabase = supabaseBrowser();
  const [sections, setSections] = useState(() => sortSections(initial));
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Live: sections Claude writes during an interview, and edits from another tab.
  useEffect(() => {
    const topic = `profile:${deskId}:${Math.random().toString(36).slice(2, 10)}`;
    const filter = `desk_id=eq.${deskId}`;
    const channel = supabase
      .channel(topic)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "profile_sections", filter }, (p) =>
        setSections((l) => mergeSection(l, p.new as SectionRow)),
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profile_sections", filter }, (p) =>
        setSections((l) => mergeSection(l, p.new as SectionRow)),
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "profile_sections" }, (p) => {
        const id = (p.old as { id?: string }).id;
        if (id) setSections((l) => removeSection(l, id));
      })
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        // Catch up on anything missed while connecting.
        void supabase
          .from("profile_sections")
          .select(SECTION_COLS)
          .eq("desk_id", deskId)
          .then(({ data }) => data && setSections(sortSections(data as SectionRow[])));
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, deskId]);

  async function add() {
    setError(null);
    const { data, error } = await supabase
      .from("profile_sections")
      .insert({ desk_id: deskId, title: "", body: "", sort: nextSort(sections) })
      .select(SECTION_COLS)
      .single();
    if (error) return setError(`Couldn't add a section (${error.message}).`);
    setSections((l) => mergeSection(l, data as SectionRow));
    setFocusId((data as SectionRow).id);
  }

  async function move(index: number, dir: -1 | 1) {
    const changes = moveSection(sections, index, dir);
    if (!changes) return;
    const before = sections;
    setSections((l) => sortSections(l.map((s) => ({ ...s, sort: changes.find((c) => c.id === s.id)?.sort ?? s.sort }))));
    const results = await Promise.all(changes.map((c) => supabase.from("profile_sections").update({ sort: c.sort }).eq("id", c.id)));
    const failed = results.find((r) => r.error);
    if (failed) {
      setSections(before);
      setError(`Couldn't move it (${failed.error!.message}).`);
    }
  }

  async function remove(id: string) {
    const { error } = await supabase.from("profile_sections").delete().eq("id", id);
    if (error) return setError(`Couldn't remove it (${error.message}).`);
    setSections((l) => removeSection(l, id));
  }

  return (
    <div className="flex flex-col gap-4">
      {sections.length === 0 && (
        <p className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-muted">
          Nothing here yet. Add a section yourself (Activities, a story about you, what you want to study and why), or start
          the interview and Claude writes them as you talk.
        </p>
      )}
      <ol className="flex flex-col gap-4" aria-label="Profile sections">
        {sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            autoFocus={focusId === s.id}
            first={i === 0}
            last={i === sections.length - 1}
            onMove={(dir) => void move(i, dir)}
            onRemove={() => remove(s.id)}
            onError={setError}
          />
        ))}
      </ol>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div>
        <button type="button" className="btn" onClick={() => void add()}>
          Add a section
        </button>
      </div>
    </div>
  );
}

function SectionCard({
  section,
  autoFocus,
  first,
  last,
  onMove,
  onRemove,
  onError,
}: {
  section: SectionRow;
  autoFocus: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => Promise<void>;
  onError: (e: string | null) => void;
}) {
  const supabase = supabaseBrowser();
  const [draft, setDraft] = useState({ title: section.title, body: section.body });
  const [synced, setSynced] = useState(section.updated_at);
  const [focused, setFocused] = useState(false);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ title: string; body: string } | null>(null);

  // Someone else changed it (Claude, another tab): show theirs unless the student is typing here.
  if (section.updated_at !== synced && !focused && !dirty) {
    setSynced(section.updated_at);
    setDraft({ title: section.title, body: section.body });
  }

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    const { error } = await supabase
      .from("profile_sections")
      .update({ title: next.title.slice(0, 200), body: next.body, updated_by: "", updated_at: new Date().toISOString() })
      .eq("id", section.id);
    if (!pending.current) setDirty(false);
    onError(error ? `Couldn't save "${next.title || "a section"}" (${error.message}).` : null);
  }, [supabase, section.id, onError]);

  // Save whatever is left when the card goes away.
  const latestFlush = useRef(flush);
  useEffect(() => {
    latestFlush.current = flush;
  }, [flush]);
  useEffect(() => () => void latestFlush.current(), []);

  const change = (next: { title: string; body: string }) => {
    setDraft(next);
    setDirty(true);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_MS);
  };

  const focus = {
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      void flush();
    },
  };

  return (
    <li className="card flex flex-col gap-2 px-4 py-3" data-testid="profile-section">
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent font-serif text-lg outline-none"
          value={draft.title}
          placeholder="Section title"
          aria-label="Section title"
          maxLength={200}
          autoFocus={autoFocus}
          onChange={(e) => change({ ...draft, title: e.target.value })}
          {...focus}
        />
        <button type="button" className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move up" disabled={first} onClick={() => onMove(-1)}>
          ↑
        </button>
        <button type="button" className="text-muted hover:text-ink disabled:opacity-30" aria-label="Move down" disabled={last} onClick={() => onMove(1)}>
          ↓
        </button>
      </div>
      <FormattedTextarea
        className="field min-h-24 resize-y"
        rows={Math.min(16, Math.max(3, draft.body.split("\n").length + 1))}
        value={draft.body}
        placeholder="In your own words: what happened, who was there, what changed."
        aria-label={`${draft.title || "Section"} text`}
        onChange={(e) => change({ ...draft, body: e.target.value })}
        {...focus}
      />
      <div className="flex justify-end">
        <ConfirmButton label="Remove" confirmLabel="Remove" question={`Remove "${draft.title || "this section"}"?`} onConfirm={onRemove} />
      </div>
    </li>
  );
}
