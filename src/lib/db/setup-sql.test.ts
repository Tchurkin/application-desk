import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSetupSql, clashes, definitions, migrationFiles, PROBES } from "./setup-sql";

const root = join(__dirname, "..", "..", "..");
const migrations = join(root, "supabase", "migrations");
const target = join(root, "supabase", "setup.sql");

describe("supabase/setup.sql", () => {
  it("knows how to tell every migration already ran", () => {
    for (const m of migrationFiles(migrations)) expect(PROBES[m.version], m.name).toBeTruthy();
  });

  it("is built from the migrations as they are now (UPDATE_SETUP_SQL=1 rebuilds it)", () => {
    const built = buildSetupSql(migrations);
    if (process.env.UPDATE_SETUP_SQL) writeFileSync(target, built);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, "utf8").replace(/\r\n/g, "\n")).toBe(built);
  });

  it("applies every migration, in order, each once", () => {
    const built = buildSetupSql(migrations);
    const order = migrationFiles(migrations).map((m) => built.indexOf(`execute $m${m.version}$`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("reads what a migration defines", () => {
    const sql = [
      "create or replace function public.do_thing(x int) returns int language sql as $$ select public.other(x) $$;",
      "revoke all on function public.do_thing(int) from public;",
      "drop trigger if exists on_thing on auth.users; create trigger on_thing after insert on auth.users;",
      'drop policy if exists "owner reads" on public.things; create policy "owner reads" on public.things for select using (true);',
      "alter table public.things drop constraint if exists things_kind_check; alter table public.things add constraint things_kind_check check (true);",
      "-- create table public.only_in_a_comment (id int);",
      "create table if not exists public.things (id int); create unique index if not exists things_one on public.things (id);",
      "alter table public.things add column if not exists note text; alter table public.things alter column note set default '';",
      "alter publication supabase_realtime add table public.things, public.others;",
    ].join("\n");
    expect([...definitions(sql)].sort()).toEqual([
      "column things.note",
      "constraint things_kind_check",
      "function do_thing",
      "index things_one",
      'policy "owner reads" on things',
      "realtime others",
      "realtime things",
      "table things",
      "trigger on_thing",
    ]);
  });

  it("counts taking something away as defining it too", () => {
    const sql = [
      "drop table if exists public.old_things; drop index if exists public.things_one;",
      "create or replace trigger on_thing after insert on auth.users; drop policy tidy on public.things;",
      "create or replace view public.thing_counts as select 1; drop type if exists public.thing_kind;",
      "alter table public.things drop column if exists note, add column kind text;",
      "alter publication supabase_realtime drop table public.others;",
      "select cron.unschedule('empty-trash');",
    ].join("\n");
    expect([...definitions(sql)].sort()).toEqual([
      "column things.kind",
      "column things.note",
      "index things_one",
      "job empty-trash",
      'policy "tidy" on things',
      "realtime others",
      "table old_things",
      "trigger on_thing",
      "type thing_kind",
      "view thing_counts",
    ]);
  });

  it("runs a skipped migration late only when nothing already after it changes the same things", () => {
    const all = migrationFiles(migrations);
    const at = (v: string) => String(all.findIndex((m) => m.version.startsWith(v)) + 1);
    const c = clashes(all);
    // Skipped on the live database (9/26/26), after 20261010 and 20261012 were applied: the Trash,
    // sign-in, and the fix to sign-in. They touch nothing later, but 20261011 undoes 20261009's
    // trigger, so 20261009 may never run after it (setup.sql runs both, in order).
    expect(c[at("20261008")]).toBeUndefined();
    expect(Object.keys(c[at("20261009")] ?? {})).toEqual([at("20261011")]);
    expect(c[at("20261011")]).toBeUndefined();
    // A real clash: the counselor's poll, redefined by the next migration.
    expect(c[at("20261002")]?.[at("20261003")]).toContain("function connector_counselor_poll");
    // And setup.sql carries them.
    expect(buildSetupSql(migrations)).toContain(`"${at("20261002")}":{"${at("20261003")}":"`);
  });
});
