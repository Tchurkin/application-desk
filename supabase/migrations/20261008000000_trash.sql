-- The Trash.
--
-- Braxton's call (9/24/26): nothing a student deletes is gone at once. A deleted piece, or a
-- deleted college with all its pieces, goes to the Trash for 30 days with everything that went
-- with it (the text and its unsaved edits, the version history, suggestions, letters), whoever
-- deleted it: the student, or Claude through the connector. Restoring puts it all back as it
-- was, with the same ids. Deleting the whole account skips the Trash: that is meant to be final.

create table if not exists public.trash (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  kind       text not null check (kind in ('piece', 'college')),
  title      text not null default '',
  -- For a piece, its college; for a college, how many pieces went with it.
  detail     text not null default '',
  data       jsonb not null,
  deleted_by text not null default '',
  deleted_at timestamptz not null default now()
);
create index if not exists trash_desk on public.trash (desk_id, deleted_at desc);
create index if not exists trash_age on public.trash (deleted_at);

alter table public.trash enable row level security;
drop policy if exists "owner reads trash" on public.trash;
create policy "owner reads trash" on public.trash
  for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner empties trash" on public.trash;
create policy "owner empties trash" on public.trash
  for delete using (public.is_desk_owner(desk_id));
-- No insert or update: rows come only from the triggers below.

-- Everything that goes with one piece, as it is right now.
create or replace function public.piece_snapshot(p public.pieces)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'piece', to_jsonb(p),
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', u.client_id, 'update', u."update", 'created_at', u.created_at) order by u.id)
        from public.piece_updates u where u.piece_id = p.id), '[]'::jsonb),
    'versions', coalesce((select jsonb_agg(to_jsonb(v)) from public.piece_versions v where v.piece_id = p.id), '[]'::jsonb),
    'suggestions', coalesce((select jsonb_agg(to_jsonb(s)) from public.suggestions s where s.piece_id = p.id), '[]'::jsonb),
    -- Its Ask and Polish thread with the counselor.
    'requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.desk_requests q where q.piece_id = p.id), '[]'::jsonb)
  );
$$;
revoke all on function public.piece_snapshot(public.pieces) from public, anon, authenticated;

-- Who deleted it: the assistant a connector deleted it for (its delete functions say which), or
-- the signed-in student.
create or replace function public.trash_who()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.deleted_by', true), ''),
                  case when auth.uid() is null then 'Claude' else 'you' end);
$$;

-- The connector's deletes name the assistant (the link's label: Claude or ChatGPT), for this
-- request only.
create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform set_config('app.deleted_by', (public.connector_link(token)).label, true);
  perform public.connector_delete_college_unchecked(token, college);
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform set_config('app.deleted_by', (public.connector_link(token)).label, true);
  perform public.connector_delete_piece_unchecked(token, piece);
end;
$$;

create or replace function public.trash_piece()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Going with the whole account, or with its college (whose own entry holds it): no entry.
  if not exists (select 1 from public.desks where id = old.desk_id) then return old; end if;
  if old.college_id is not null and not exists (select 1 from public.colleges where id = old.college_id) then return old; end if;
  insert into public.trash (desk_id, kind, title, detail, data, deleted_by)
  values (old.desk_id, 'piece', old.title,
          coalesce((select name from public.colleges where id = old.college_id), ''),
          public.piece_snapshot(old), public.trash_who());
  delete from public.trash where deleted_at < now() - interval '30 days';
  return old;
end;
$$;
drop trigger if exists pieces_to_trash on public.pieces;
create trigger pieces_to_trash before delete on public.pieces
  for each row execute function public.trash_piece();

create or replace function public.trash_college()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  n integer;
  letters jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.desks where id = old.desk_id) then return old; end if;
  select count(*) into n from public.pieces where college_id = old.id;
  -- Letters exist from migration 20261005 on.
  if to_regclass('public.letters') is not null then
    execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.letters x where x.college_id = $1'
      into letters using old.id;
  end if;
  insert into public.trash (desk_id, kind, title, detail, data, deleted_by)
  values (old.desk_id, 'college', old.name,
          case when n = 0 then 'no pieces' when n = 1 then '1 piece' else n::text || ' pieces' end,
          jsonb_build_object(
            'college', to_jsonb(old),
            'pieces', coalesce((select jsonb_agg(public.piece_snapshot(p) order by p.sort, p.created_at)
                                  from public.pieces p where p.college_id = old.id), '[]'::jsonb),
            'letters', letters),
          public.trash_who());
  delete from public.trash where deleted_at < now() - interval '30 days';
  return old;
end;
$$;
drop trigger if exists colleges_to_trash on public.colleges;
create trigger colleges_to_trash before delete on public.colleges
  for each row execute function public.trash_college();

-- Put one piece back from its snapshot. Its college may be gone: then it comes back on its own.
create or replace function public.restore_piece(snap jsonb, d uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  r jsonb := snap -> 'piece';
  pid uuid := (r ->> 'id')::uuid;
begin
  if exists (select 1 from public.pieces where id = pid) then
    raise exception 'That piece is already on the desk.';
  end if;
  if r ->> 'college_id' is not null
     and not exists (select 1 from public.colleges where id = (r ->> 'college_id')::uuid and desk_id = d) then
    if exists (select 1 from public.trash t
                where t.desk_id = d and t.kind = 'college' and t.data -> 'college' ->> 'id' = r ->> 'college_id') then
      raise exception 'Its college is in the Trash too. Restore the college first, then this piece.';
    end if;
    r := jsonb_set(r, '{college_id}', 'null'::jsonb);
  end if;
  if r ->> 'variant_of' is not null and not exists (select 1 from public.pieces where id = (r ->> 'variant_of')::uuid) then
    r := jsonb_set(r, '{variant_of}', 'null'::jsonb);
  end if;
  r := jsonb_set(r, '{desk_id}', to_jsonb(d));
  insert into public.pieces select * from jsonb_populate_record(null::public.pieces, r);
  insert into public.piece_updates (piece_id, client_id, "update", created_at)
    select pid, x.client_id, x."update", x.created_at
      from jsonb_to_recordset(coalesce(snap -> 'updates', '[]'::jsonb)) as x(client_id text, "update" text, created_at timestamptz);
  insert into public.piece_versions
    select * from jsonb_populate_recordset(null::public.piece_versions, coalesce(snap -> 'versions', '[]'::jsonb));
  insert into public.suggestions
    select s.* from jsonb_populate_recordset(null::public.suggestions, coalesce(snap -> 'suggestions', '[]'::jsonb)) s
     where exists (select 1 from auth.users u where u.id = s.author_id);
  insert into public.desk_requests
    select q.* from jsonb_populate_recordset(null::public.desk_requests, coalesce(snap -> 'requests', '[]'::jsonb)) q
  on conflict (id) do nothing;
  return pid;
end;
$$;
revoke all on function public.restore_piece(jsonb, uuid) from public, anon, authenticated;

-- Restore something from the student's Trash. Returns {kind, id} of what came back.
create or replace function public.restore_trash(item uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t public.trash;
  c jsonb;
  cid uuid;
  pid uuid;
  p jsonb;
begin
  select * into t from public.trash where id = item for update;
  if not found or t.deleted_at < now() - interval '30 days' or not public.is_desk_owner(t.desk_id) then
    raise exception 'That isn''t in your Trash any more.';
  end if;
  if t.kind = 'college' then
    c := jsonb_set(t.data -> 'college', '{desk_id}', to_jsonb(t.desk_id));
    cid := (c ->> 'id')::uuid;
    if exists (select 1 from public.colleges where id = cid) then
      raise exception 'That college is already on the desk.';
    end if;
    insert into public.colleges select * from jsonb_populate_record(null::public.colleges, c);
    for p in select * from jsonb_array_elements(coalesce(t.data -> 'pieces', '[]'::jsonb)) loop
      perform public.restore_piece(p, t.desk_id);
    end loop;
    if to_regclass('public.letters') is not null then
      execute 'insert into public.letters
                 select x.* from jsonb_populate_recordset(null::public.letters, $1) x
                  where exists (select 1 from public.recommenders r where r.id = x.recommender_id and r.desk_id = $2)
               on conflict do nothing'
        using coalesce(t.data -> 'letters', '[]'::jsonb), t.desk_id;
    end if;
  else
    pid := public.restore_piece(t.data, t.desk_id);
  end if;
  delete from public.trash where id = t.id;
  return jsonb_build_object('kind', t.kind, 'id', coalesce(cid, pid));
end;
$$;
revoke all on function public.restore_trash(uuid) from public, anon;
grant execute on function public.restore_trash(uuid) to authenticated;

-- Empty what's past 30 days every night, whether or not anyone deletes anything (where the
-- database has pg_cron; otherwise it's emptied as the Trash is used).
do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
  perform cron.schedule('empty-trash', '17 3 * * *', $job$delete from public.trash where deleted_at < now() - interval '30 days'$job$);
exception when others then
  raise notice 'pg_cron is not available here; the Trash is emptied as it is used.';
end;
$$;
