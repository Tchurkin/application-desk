import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * supabase/setup.sql: every migration in one file to paste into the Supabase SQL Editor, which
 * applies only the ones a database doesn't have yet. A hosted project gets its migrations pasted
 * by hand, so nothing records which ran; each migration is recognized by something only it
 * creates (PROBES), and the file records what it has seen in average_app.migrations so later
 * runs needn't guess. It is built from supabase/migrations by setup-sql.test.ts
 * (UPDATE_SETUP_SQL=1 rewrites it); a migration without a probe fails that test.
 */

const fn = (name: string) =>
  `exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = '${name}')`;
const col = (table: string, column: string) =>
  `exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${table}' and column_name = '${column}')`;
const tbl = (name: string) => `to_regclass('public.${name}') is not null`;

/** How to tell each migration already ran: something it made that nothing before it did. */
export const PROBES: Record<string, string> = {
  "20260923000000": tbl("desks"),
  "20260924000000": tbl("share_links"),
  "20260925000000": tbl("connector_links"),
  "20260926000000": fn("connector_write"),
  "20260927000000": fn("connector_app_system"),
  "20260928000000": tbl("desk_requests"),
  "20260929000000": fn("connector_watch"),
  "20260930000000": fn("set_piece_text_stats"),
  "20261001000000": tbl("profile_sections"),
  "20261002000000": col("connector_links", "counselor_version"),
  "20261003000000": col("connector_links", "replaces"),
  "20261004000000": col("connector_links", "counselor_model"),
  "20261005000000": tbl("recommenders"),
  "20261006000000": col("profiles", "class_rank"),
  "20261007000000": col("colleges", "submitted_at"),
  "20261008000000": tbl("trash"),
  "20261009000000": fn("forget_unconfirmed_password"),
  "20261010000000": tbl("share_passwords"),
  // It only drops 20261009's trigger: ran if that one did and the trigger is gone.
  "20261011000000": `${fn("forget_unconfirmed_password")} and not exists (select 1 from pg_trigger where tgname = 'forget_unconfirmed_password' and tgrelid = to_regclass('auth.users'))`,
  "20261012000000": `coalesce(position('Average App' in pg_get_functiondef(to_regprocedure('public.connector_link(text)'))) > 0, false)`,
  "20261013000000": col("share_passwords", "share_name"),
};

export function migrationFiles(dir: string): { version: string; name: string; sql: string }[] {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: f.slice(0, 14), name: f.replace(/\.sql$/, ""), sql: readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n") }));
}

export function buildSetupSql(dir: string): string {
  const all = migrationFiles(dir);
  const missing = all.filter((m) => !PROBES[m.version]).map((m) => m.name);
  if (missing.length) throw new Error(`No probe for ${missing.join(", ")}: add one to PROBES in src/lib/db/setup-sql.ts.`);
  for (const m of all) if (m.sql.includes(`$m${m.version}$`)) throw new Error(`${m.name} contains its own quote tag.`);

  const head = `-- Average App: set up (or bring up to date) the database.
--
-- Paste all of this into the Supabase SQL Editor (Database > SQL Editor > New query) and run it.
-- It works out which migrations your database already has and applies only the missing ones, in
-- order, all or nothing. Running it again is safe: it does nothing when everything is there.
-- At the end it lists every migration your database has.
--
-- Built from supabase/migrations by src/lib/db/setup-sql.ts; don't edit it by hand.

create schema if not exists average_app;
revoke all on schema average_app from public;
create table if not exists average_app.migrations (version text primary key, name text not null, applied_at timestamptz not null default now());

do $setup$
declare
  names text[] := array[${all.map((m) => `'${m.name}'`).join(", ")}];
  marked text[];
  cli text[] := '{}';
  have boolean[];
  first_missing int;
  gap text;
  applied int := 0;
begin
  select coalesce(array_agg(version), '{}') into marked from average_app.migrations;
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    execute 'select coalesce(array_agg(version::text), ''{}'') from supabase_migrations.schema_migrations' into cli;
  end if;
  have := array[
${all.map((m) => `    ('${m.version}' = any(marked)) or ('${m.version}' = any(cli)) or (${PROBES[m.version]})`).join(",\n")}
  ];

  for i in 1 .. array_length(names, 1) loop
    if not have[i] then
      first_missing := coalesce(first_missing, i);
    elsif first_missing is not null then
      gap := coalesce(gap || ', ', '') || names[i];
    end if;
  end loop;
  if gap is not null then
    raise exception 'Nothing was changed: % is missing, but later migrations are already applied (%). Applying it now could undo them, so get help first.', names[first_missing], gap;
  end if;

  -- Remember what is already here, so a later run needn't work it out again.
  for i in 1 .. array_length(names, 1) loop
    if have[i] then
      insert into average_app.migrations (version, name) values (left(names[i], 14), names[i]) on conflict (version) do nothing;
    end if;
  end loop;

${all
  .map(
    (m, i) => `  if not have[${i + 1}] then
    execute $m${m.version}$
${m.sql.trim()}
$m${m.version}$;
    insert into average_app.migrations (version, name) values ('${m.version}', '${m.name}');
    applied := applied + 1;
    raise notice 'Applied %', '${m.name}';
  end if;
`,
  )
  .join("\n")}
  if applied = 0 then
    raise notice 'Your database is up to date: nothing to do.';
  else
    raise notice 'Done: applied % migration(s).', applied;
  end if;
end
$setup$;

select version, name, applied_at from average_app.migrations order by version;
`;
  return head;
}
