-- Updating the counselor without a gap, and never acting on a withdrawn request.
--
-- "Update the counselor" makes a new link for the new setup file. The old counselor keeps
-- answering until the new one first checks in; only then is the old link revoked (which also
-- turns the old one off wherever it runs). Before, the old link was revoked at once, so the desk
-- had no counselor until the new file was run, and none at all if it was downloaded on a phone.

alter table public.connector_links add column if not exists replaces uuid references public.connector_links (id) on delete set null;

-- From 20261002, in case an earlier copy of it was run: the poll below reads it.
alter table public.connector_links add column if not exists counselor_remove boolean not null default false;
create or replace function public.connector_counselor_removed(token text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set revoked_at = now() where id = l.id;
end;
$$;
grant execute on function public.connector_counselor_removed(text) to anon, authenticated;

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
  -- 'pending' lets the counselor drop anything the student withdrew while it waited in its queue.
  return jsonb_build_object('fresh', fresh, 'waiting', waiting, 'speed', l.counselor_speed, 'paused', l.counselor_paused,
                            'remove', l.counselor_remove, 'pending', pending_ids);
end;
$$;

grant execute on function public.connector_counselor_poll(text, text) to anon, authenticated;
