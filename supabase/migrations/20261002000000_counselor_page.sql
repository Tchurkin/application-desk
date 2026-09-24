-- The Counselor page, and a faster counselor.
--
-- Braxton's calls (9/24/26): the counselor on the student's computer should answer faster, and a
-- Counselor page lets the student talk to it directly, see what it's doing, and control it.
--
-- - 'chat' requests: messages to the counselor from the Counselor page.
-- - Each counselor link has a speed (which Claude model and effort it runs), can be paused from
--   the website, and reports which version of the counselor is installed.
-- - The counselor streams its answer into the request while it writes (a draft in `answer`,
--   status still 'pending'), then finishes it.
-- - `activity` records the last thing an assistant did through the connector, so the website can
--   say "Reading 'Why us'" while it works.

alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check
  check (kind in ('ask','polish','odds','interview','chat'));

alter table public.connector_links
  add column if not exists counselor_speed text not null default 'balanced'
    check (counselor_speed in ('fast','balanced','thorough')),
  add column if not exists counselor_paused boolean not null default false,
  add column if not exists counselor_version text not null default '' check (length(counselor_version) <= 20),
  add column if not exists activity jsonb,
  add column if not exists activity_at timestamptz,
  -- Asked on the website to remove itself from the student's computer; it does, then revokes
  -- its own link (connector_counselor_removed).
  add column if not exists counselor_remove boolean not null default false;

-- The counselor's watcher calls this every couple of seconds. It marks the link as watching (and
-- which version is installed), takes the requests that arrived since unless the counselor is
-- paused, and says how many are new, how many are waiting, and how fast to run.
drop function if exists public.connector_counselor_poll(text);
create or replace function public.connector_counselor_poll(token text, version text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  v text := left(coalesce(version, ''), 20);
  fresh integer := 0;
  waiting integer;
begin
  update public.connector_links set watched_at = now(), counselor_at = now(), counselor_version = v
   where id = l.id
     and (counselor_at is null or counselor_at < now() - interval '20 seconds' or counselor_version <> v);
  if not l.counselor_paused and not l.counselor_remove then
    with taken as (
      update public.desk_requests set counselor_at = now()
       where desk_id = l.desk_id and status = 'pending' and counselor_at is null
      returning 1
    )
    select count(*) into fresh from taken;
  end if;
  select count(*) into waiting from public.desk_requests where desk_id = l.desk_id and status = 'pending';
  return jsonb_build_object('fresh', fresh, 'waiting', waiting, 'speed', l.counselor_speed, 'paused', l.counselor_paused,
                            'remove', l.counselor_remove);
end;
$$;

-- The counselor has removed itself from the student's computer: its link is done.
create or replace function public.connector_counselor_removed(token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set revoked_at = now() where id = l.id;
end;
$$;

-- The answer so far, while the counselor writes it. Only a waiting request takes a draft.
create or replace function public.connector_draft_answer(token text, request uuid, draft text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests set answer = left(coalesce(draft, ''), 20000)
   where id = request and desk_id = l.desk_id and status = 'pending';
end;
$$;

-- Finish a request with the counselor's reply. Returns false when it isn't waiting any more (the
-- student dismissed it, or it was already answered), so a dismissal is never undone.
create or replace function public.connector_finish_request(token text, request uuid, answer_text text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests
     set status = 'answered', answer = left(coalesce(answer_text, ''), 20000), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id and status = 'pending';
  return found;
end;
$$;

-- What the assistant is doing: a connector tool it just used (with the piece, if any), or
-- 'thinking' / 'idle' from the counselor. The counselor names the request it has started on;
-- the tools it uses on that request keep it, and 'idle' clears it.
create or replace function public.connector_activity(token text, tool text, piece uuid default null, request uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  working_on text := case
    when request is not null then request::text
    when coalesce(tool, '') = 'idle' then null
    else l.activity ->> 'request'
  end;
begin
  update public.connector_links
     set activity = jsonb_build_object(
           'tool', left(coalesce(tool, ''), 60),
           'piece', (select p.title from public.pieces p where p.id = piece and p.desk_id = l.desk_id),
           'request', working_on),
         activity_at = now()
   where id = l.id;
end;
$$;

grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
grant execute on function public.connector_counselor_removed(text) to anon, authenticated;
grant execute on function public.connector_draft_answer(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_finish_request(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_activity(text, text, uuid, uuid) to anon, authenticated;
