/*
 * The Profile page's sections, kept in step with realtime row changes and reordered by
 * swapping neighbours. Pure, so the rules are tested without a database.
 */

export interface SectionRow {
  id: string;
  desk_id: string;
  title: string;
  body: string;
  sort: number;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export const SECTION_COLS = "id, desk_id, title, body, sort, updated_by, created_at, updated_at";

function byOrder(a: SectionRow, b: SectionRow) {
  return a.sort - b.sort || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

export function sortSections(rows: SectionRow[]): SectionRow[] {
  return [...rows].sort(byOrder);
}

/** Apply an inserted or updated row. */
export function mergeSection(list: SectionRow[], row: SectionRow): SectionRow[] {
  return sortSections([...list.filter((s) => s.id !== row.id), row]);
}

export function removeSection(list: SectionRow[], id: string): SectionRow[] {
  const rest = list.filter((s) => s.id !== id);
  return rest.length === list.length ? list : rest;
}

/** The sort for a new section at the end. */
export function nextSort(list: SectionRow[]): number {
  return list.reduce((m, s) => Math.max(m, s.sort), 0) + 1;
}

/**
 * Move the section at `index` up (-1) or down (+1): the two rows' new sort values, or null at
 * either end. Equal sorts (rows added at the same moment) are pulled apart first.
 */
export function moveSection(list: SectionRow[], index: number, dir: -1 | 1): { id: string; sort: number }[] | null {
  const other = index + dir;
  if (index < 0 || index >= list.length || other < 0 || other >= list.length) return null;
  const a = list[index];
  const b = list[other];
  if (a.sort === b.sort) {
    return dir < 0
      ? [
          { id: a.id, sort: b.sort - 0.5 },
          { id: b.id, sort: b.sort },
        ]
      : [
          { id: a.id, sort: b.sort + 0.5 },
          { id: b.id, sort: b.sort },
        ];
  }
  return [
    { id: a.id, sort: b.sort },
    { id: b.id, sort: a.sort },
  ];
}
