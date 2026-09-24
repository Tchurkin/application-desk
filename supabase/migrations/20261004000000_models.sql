-- Choosing the Claude model.
--
-- Braxton's call (9/24/26): wherever AI is used, the model can be changed (Haiku, Sonnet, Opus,
-- Fable). The counselor has a default model and how hard it thinks; each request can ask for a
-- model of its own (Ask, Polish, odds, the chat, the interview). A Claude or ChatGPT chat uses
-- the model picked in that app; this only steers the counselor on the student's computer.

alter table public.connector_links
  add column if not exists counselor_model text not null default 'sonnet'
    check (counselor_model in ('haiku','sonnet','opus','fable')),
  add column if not exists counselor_effort text not null default 'medium'
    check (counselor_effort in ('low','medium','high'));

-- Speeds picked so far become the same model and effort (only on links still at the defaults,
-- so running this again changes nothing).
update public.connector_links set
  counselor_model = case counselor_speed when 'thorough' then 'opus' else 'sonnet' end,
  counselor_effort = case counselor_speed when 'fast' then 'low' when 'thorough' then 'high' else 'medium' end
 where counselor_speed <> 'balanced' and counselor_model = 'sonnet' and counselor_effort = 'medium';

-- '' means the counselor's default.
alter table public.desk_requests add column if not exists model text not null default ''
  check (model in ('','haiku','sonnet','opus','fable'));

-- Requests waiting for the assistant, oldest first, with the model each asks for.
create or replace function public.connector_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at, 'model', r.model) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending'), '[]'::jsonb);
end;
$$;

-- The poll also says which model and effort to run. 'speed' stays for counselors installed
-- before this (version 2), as the nearest of their three speeds.
create or replace function public.connector_counselor_poll(token text, version text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  fresh integer := 0;
  waiting integer;
  pending_ids jsonb;
begin
  update public.connector_links set watched_at = now(), counselor_at = now(), counselor_version = v
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v);
  -- The counselor this one replaces stops now that this one is running.
  if l.replaces is not null then
    update public.connector_links set revoked_at = now()
     where id = l.replaces and desk_id = l.desk_id and revoked_at is null;
    update public.connector_links set replaces = null where id = l.id;
  end if;
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now()
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  select count(*), coalesce(jsonb_agg(r.id), '[]'::jsonb) into waiting, pending_ids
    from public.desk_requests r where r.desk_id = l.desk_id and r.status = 'pending';
  return jsonb_build_object(
    'fresh', fresh, 'waiting', waiting, 'paused', l.counselor_paused, 'remove', l.counselor_remove, 'pending', pending_ids,
    'model', l.counselor_model, 'effort', l.counselor_effort,
    'speed', case when l.counselor_model in ('opus','fable') then 'thorough' when l.counselor_effort = 'low' then 'fast' else 'balanced' end);
end;
$$;

grant execute on function public.connector_requests(text) to anon, authenticated;
grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
