"use client";
import Link from "next/link";
import { useState } from "react";
import { barWidth, formatMoney, formatPercent, SOURCE_LABEL, type Band, type StrategyRow } from "@/lib/strategy/bands";
import type { StrategyCollegeView } from "@/lib/strategy/load";
import { StrategyEditor } from "./strategy-editor";

/*
 * One college's row in a band table (or the international table), with its editor and the
 * reasoning behind its chance opening in a row underneath.
 */

export const ODDS_COLUMNS = 7;
export const INTL_COLUMNS = 6;

const BAR: Record<Band, string> = { reach: "bg-danger", target: "bg-warn", likely: "bg-accent", unrated: "bg-muted" };

const SOURCE_HINT = {
  ai: "Estimated by your connected AI from your profile.",
  student: "The chance you set.",
  average: "The college's published average admission rate (College Scorecard). It ignores your profile, so it isn't your personal chance.",
} as const;

const cell = "px-3 py-2 align-top";

function CollegeCell({ college }: { college: StrategyCollegeView }) {
  return (
    <td className={`${cell} font-medium`}>
      <Link href={`/desk/college/${college.id}`} className="hover:underline">{college.name}</Link>
    </td>
  );
}

function EditButton({ name, open, onClick }: { name: string; open: boolean; onClick: () => void }) {
  return (
    <td className={`${cell} text-right`}>
      <button type="button" className="btn px-2 py-0.5 text-xs" aria-label={`Edit ${name}`} aria-expanded={open} onClick={onClick}>
        Edit
      </button>
    </td>
  );
}

const outOf10 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v}/10`);

export function OddsRow({ row, editable }: { row: StrategyRow<StrategyCollegeView>; editable: boolean }) {
  const [open, setOpen] = useState<"none" | "edit" | "why">("none");
  const { college, chance, band, cost } = row;
  const note = college.chance_note?.trim() ?? "";
  const toggle = (v: "edit" | "why") => setOpen(open === v ? "none" : v);
  const noteId = `${college.id}-why`;

  return (
    <>
      <tr className="border-t border-line" data-college={college.id}>
        <CollegeCell college={college} />
        <td className={`${cell} min-w-40`}>
          {chance ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-12 shrink-0 font-mono tabular-nums">{formatPercent(chance.value)}</span>
                <span className="h-2 min-w-[70px] flex-1 overflow-hidden rounded-sm bg-line" aria-hidden>
                  <span className={`block h-full ${BAR[band]}`} style={{ width: `${barWidth(chance.value)}%` }} />
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                <span title={SOURCE_HINT[chance.source]}>{SOURCE_LABEL[chance.source]}</span>
                {note && (
                  <button
                    type="button"
                    className="text-accent underline-offset-2 hover:underline"
                    aria-expanded={open === "why"}
                    aria-controls={open === "why" ? noteId : undefined}
                    onClick={() => toggle("why")}
                  >
                    Why?
                  </button>
                )}
              </div>
            </>
          ) : (
            <span className="text-muted">Not set</span>
          )}
        </td>
        <td className={`${cell} font-mono tabular-nums`}>{college.fit_rank ? `#${college.fit_rank}` : "—"}</td>
        <td className={`${cell} font-mono tabular-nums`}>{outOf10(college.campus_life)}</td>
        <td className={`${cell} font-mono tabular-nums`}>{outOf10(college.reputation)}</td>
        <td className={`${cell} whitespace-nowrap`}>
          {cost ? (
            <>
              <span className="font-mono tabular-nums">{formatMoney(cost.amount)}</span>{" "}
              <span className="text-xs text-muted" title={cost.average ? "The college's published average, not your price." : undefined}>
                {cost.average ? "avg " : ""}
                {cost.kind === "net" ? "after aid" : "sticker"}
              </span>
            </>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        {editable ? <EditButton name={college.name} open={open === "edit"} onClick={() => toggle("edit")} /> : <td />}
      </tr>
      {open === "why" && (
        <tr>
          <td colSpan={ODDS_COLUMNS} id={noteId} className="bg-bg px-3 py-2 text-sm whitespace-normal">
            <span className="font-medium">{chance?.source === "ai" ? "The AI's reasoning: " : "Reasoning: "}</span>
            {note}
          </td>
        </tr>
      )}
      {open === "edit" && (
        <tr>
          <td colSpan={ODDS_COLUMNS} className="bg-bg px-3">
            <StrategyEditor college={college} kind="odds" onDone={() => setOpen("none")} />
          </td>
        </tr>
      )}
    </>
  );
}

export function IntlRow({ college, editable }: { college: StrategyCollegeView; editable: boolean }) {
  const [editing, setEditing] = useState(false);
  const text = (v: string | null | undefined) => (v?.trim() ? v : <span className="text-muted">—</span>);
  const wrap = `${cell} min-w-40 whitespace-normal`;
  return (
    <>
      <tr className="border-t border-line" data-college={college.id}>
        <td className={`${cell} font-medium`}>
          <Link href={`/desk/college/${college.id}`} className="hover:underline">{college.name}</Link>
          <span className="block text-xs font-normal text-muted">{college.country}</span>
        </td>
        <td className={wrap}>{text(college.intl_course)}</td>
        <td className={wrap}>{text(college.intl_criterion)}</td>
        <td className={wrap}>{text(college.intl_cost)}</td>
        <td className={wrap}>{text(college.intl_status)}</td>
        {editable ? <EditButton name={college.name} open={editing} onClick={() => setEditing(!editing)} /> : <td />}
      </tr>
      {editing && (
        <tr>
          <td colSpan={INTL_COLUMNS} className="bg-bg px-3">
            <StrategyEditor college={college} kind="intl" onDone={() => setEditing(false)} />
          </td>
        </tr>
      )}
    </>
  );
}
