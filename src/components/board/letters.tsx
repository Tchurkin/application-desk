"use client";
import { useState, type FormEvent } from "react";
import { Popover } from "@/components/popover";
import {
  colorOf,
  LETTER_STATUSES,
  letterCount,
  lettersFor,
  letterStatusLabel,
  REC_COLORS,
  sortRecommenders,
  type Letter,
  type LetterStatus,
  type Recommender,
} from "@/lib/board/letters";

/*
 * Recommenders on the board: a bar of everyone writing letters, and beside each college the
 * letters it gets, each chip in its recommender's color (dashed until asked, filled once sent).
 */

export interface LetterActions {
  canWrite: boolean;
  /** The database has recommenders (migration 20261005). */
  ready: boolean;
  recommenders: Recommender[];
  letters: Letter[];
  setLetter: (recommenderId: string, collegeId: string, status: LetterStatus | null) => void;
  /** Adds one, and a letter for `collegeId` when given. False if it couldn't. */
  addRecommender: (fields: { name: string; role: string }, collegeId?: string) => Promise<boolean>;
  saveRecommender: (id: string, fields: { name?: string; role?: string; color?: number }) => Promise<boolean>;
  deleteRecommender: (id: string) => Promise<boolean>;
}

const CHIP = "inline-flex max-w-48 items-center gap-1 rounded-full px-2 py-0.5 text-xs";
const chipClass = (r: Recommender, status?: LetterStatus) => `rec-${colorOf(r)} rec-chip ${status ? `is-${status}` : ""} ${CHIP}`;

function RecommenderForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: { name: string; role: string };
  submitLabel: string;
  onSubmit: (fields: { name: string; role: string }) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), role: role.trim() });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input className="field" aria-label="Recommender's name" placeholder="Name, e.g. Ms. Rivera" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      <input className="field" aria-label="Their role" placeholder="Role, e.g. Physics teacher" value={role} maxLength={200} onChange={(e) => setRole(e.target.value)} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

/** The letters one college gets, under its name on the board. */
export function LetterRow({
  collegeId,
  collegeName,
  needsLetters,
  actions,
}: {
  collegeId: string;
  collegeName: string;
  needsLetters: boolean | undefined;
  actions: LetterActions;
}) {
  const list = lettersFor(collegeId, actions.letters, actions.recommenders);
  const taken = new Set(list.map((x) => x.recommender.id));
  const free = sortRecommenders(actions.recommenders).filter((r) => !taken.has(r.id));
  const writable = actions.canWrite && actions.ready;

  return (
    <div role="group" aria-label={`Letters for ${collegeName}`} className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">Letters</span>
      {list.map(({ letter, recommender: r }) =>
        writable ? (
          <Popover
            key={r.id}
            label={`${r.name}'s letter for ${collegeName}`}
            triggerLabel={`${r.name}: ${letterStatusLabel(letter.status)}`}
            triggerClassName={`${chipClass(r, letter.status)} hover:shadow-sm`}
            trigger={
              <>
                {letter.status === "submitted" && <span aria-hidden>✓</span>}
                <span className="truncate">{r.name}</span>
              </>
            }
          >
            {(close) => (
              <div className="flex flex-col gap-2">
                <p className="font-medium">
                  {r.name}
                  {r.role && <span className="font-normal text-muted"> · {r.role}</span>}
                </p>
                <div role="radiogroup" aria-label={`${r.name}'s letter for ${collegeName}`} className="flex flex-col gap-1">
                  {LETTER_STATUSES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={letter.status === s.id}
                      className={`rounded-md border px-2 py-1 text-left ${letter.status === s.id ? "border-accent bg-accent-soft" : "border-line hover:border-muted"}`}
                      onClick={() => {
                        actions.setLetter(r.id, collegeId, s.id);
                        close();
                      }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="self-start text-xs text-danger underline underline-offset-2"
                  onClick={() => {
                    actions.setLetter(r.id, collegeId, null);
                    close();
                  }}
                >
                  Not writing for {collegeName}
                </button>
              </div>
            )}
          </Popover>
        ) : (
          <span key={r.id} className={chipClass(r, letter.status)} title={`${r.name}: ${letterStatusLabel(letter.status)}`}>
            {letter.status === "submitted" && <span aria-hidden>✓</span>}
            <span className="truncate">{r.name}</span>
            <span className="sr-only">: {letterStatusLabel(letter.status)}</span>
          </span>
        ),
      )}
      {!list.length && <span className="text-xs text-muted">{needsLetters === false ? "none needed" : "none yet"}</span>}
      {writable && (
        <Popover
          label={`Add a letter for ${collegeName}`}
          triggerLabel={`Add a letter for ${collegeName}`}
          triggerClassName={`${CHIP} border border-dashed border-line text-muted hover:border-muted hover:text-ink`}
          trigger="+ Letter"
        >
          {(close) => (
            <div className="flex flex-col gap-3">
              {free.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="label">Who writes it</p>
                  {free.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`rec-${colorOf(r)} flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-bg`}
                      onClick={() => {
                        actions.setLetter(r.id, collegeId, "planned");
                        close();
                      }}
                    >
                      <span aria-hidden className="rec-dot inline-block size-2.5 shrink-0 rounded-full" />
                      <span className="truncate">
                        {r.name}
                        {r.role && <span className="text-muted"> · {r.role}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <p className="label">{free.length ? "Someone new" : "Who writes it"}</p>
                <RecommenderForm
                  submitLabel="Add"
                  onSubmit={async (f) => {
                    if (await actions.addRecommender(f, collegeId)) close();
                  }}
                />
              </div>
            </div>
          )}
        </Popover>
      )}
    </div>
  );
}

/** Everyone writing letters, above the board: add, rename, recolor or remove them. */
export function RecommendersBar({ actions }: { actions: LetterActions }) {
  const list = sortRecommenders(actions.recommenders);
  const writable = actions.canWrite && actions.ready;
  if (!actions.ready || (!writable && !list.length)) return null;
  return (
    <section aria-labelledby="recommenders-h" className="mb-4 flex flex-wrap items-center gap-2" data-testid="recommenders">
      <h2 id="recommenders-h" className="mr-1 text-sm font-medium">
        Recommenders
      </h2>
      {list.map((r) =>
        writable ? (
          <Popover
            key={r.id}
            label={`Edit ${r.name}`}
            triggerLabel={`${r.name}, ${letterCount(r.id, actions.letters)}`}
            triggerClassName={`${chipClass(r)} gap-1.5 hover:shadow-sm`}
            trigger={
              <>
                <span aria-hidden className="rec-dot inline-block size-2 shrink-0 rounded-full" />
                <span className="truncate">{r.name}</span>
                <span className="text-muted">· {letterCount(r.id, actions.letters)}</span>
              </>
            }
          >
            {(close) => <EditRecommender r={r} letters={actions.letters} actions={actions} close={close} />}
          </Popover>
        ) : (
          <span key={r.id} className={`${chipClass(r)} gap-1.5`}>
            <span aria-hidden className="rec-dot inline-block size-2 shrink-0 rounded-full" />
            {r.name}
            {r.role && <span className="text-muted">· {r.role}</span>}
          </span>
        ),
      )}
      {!list.length && <span className="text-sm text-muted">Add the teachers and counselor writing your letters.</span>}
      {writable && (
        <Popover
          label="Add a recommender"
          triggerClassName={`${CHIP} border border-dashed border-line text-muted hover:border-muted hover:text-ink`}
          trigger="+ Add recommender"
        >
          {(close) => (
            <RecommenderForm
              submitLabel="Add recommender"
              onSubmit={async (f) => {
                if (await actions.addRecommender(f)) close();
              }}
            />
          )}
        </Popover>
      )}
    </section>
  );
}

function EditRecommender({ r, letters, actions, close }: { r: Recommender; letters: Letter[]; actions: LetterActions; close: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const count = letters.filter((l) => l.recommender_id === r.id).length;
  return (
    <div className="flex flex-col gap-3">
      <RecommenderForm
        initial={{ name: r.name, role: r.role }}
        submitLabel="Save"
        onSubmit={async (f) => {
          if (await actions.saveRecommender(r.id, f)) close();
        }}
      />
      <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-1.5">
        {Array.from({ length: REC_COLORS }, (_, i) => (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={colorOf(r) === i}
            aria-label={`Color ${i + 1}`}
            className={`rec-${i} rec-dot size-5 rounded-full ${colorOf(r) === i ? "ring-2 ring-ink ring-offset-2 ring-offset-panel" : ""}`}
            onClick={() => void actions.saveRecommender(r.id, { color: i })}
          />
        ))}
      </div>
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-danger bg-danger-soft p-2">
          <p className="text-xs">
            Remove {r.name}
            {count ? ` and ${count} letter${count === 1 ? "" : "s"}` : ""}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (await actions.deleteRecommender(r.id)) close();
              }}
            >
              Remove
            </button>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="self-start text-xs text-danger underline underline-offset-2" onClick={() => setConfirming(true)}>
          Remove {r.name}
        </button>
      )}
    </div>
  );
}
