-- Sharing by desk name and password.
--
-- Braxton's call (9/26/26): instead of a link for each person, the student gives the desk a name
-- and sets one password, and anyone who has both opens the desk from the home page. What they may
-- do is one setting for everyone who comes in that way, kept on a share link of its own
-- (via_password): changing it, or turning sharing off, reaches all of them at once, and the student
-- can still remove one person. Links made before keep working, and the same password covers them.

-- The name lives with the password, which only the student can read: the desk row itself is
-- readable by everyone it's shared with, links included. 3 to 40 lowercase letters, digits and
-- dashes, unique; null when sharing by name is off.
alter table public.share_passwords add column if not exists share_name text
  check (share_name is null or share_name ~ '^[a-z0-9][a-z0-9-]{2,39}$');
create unique index if not exists share_passwords_share_name on public.share_passwords (share_name);

-- The one link everyone who comes in with the name and password belongs to.
alter table public.share_links add column if not exists via_password boolean not null default false;
create unique index if not exists share_links_one_password on public.share_links (desk_id) where via_password;

-- Wrong tries, to slow down guessing: counted for each visitor across every name (so one person
-- can't lock a desk for everyone), and for each desk (so many visitors can't guess together).
create table if not exists public.share_join_failures (
  user_id uuid not null,
  desk_id uuid references public.desks (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists share_join_failures_user on public.share_join_failures (user_id, at);
create index if not exists share_join_failures_desk on public.share_join_failures (desk_id, at);
alter table public.share_join_failures enable row level security;

-- Turn sharing by name on, or change it: the name, the password (blank keeps the one set) and what
-- people who come in with them may do. Returns {ok} or {ok:false, error}.
create or replace function public.set_desk_sharing(d uuid, desk_name text, pw text, r text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  pw_link uuid;
  pw_revoked timestamptz;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if r not in ('view', 'suggest', 'edit') then raise exception 'Unknown role.'; end if;
  if n !~ '^[a-z0-9][a-z0-9-]{2,39}$' then
    return jsonb_build_object('ok', false, 'error', 'Use 3 to 40 letters, numbers or dashes for the desk name, starting with a letter or number.');
  end if;
  if exists (select 1 from public.share_passwords where share_name = n and desk_id <> d) then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end if;
  if coalesce(pw, '') <> '' and length(pw) < 8 then
    return jsonb_build_object('ok', false, 'error', 'Use at least 8 characters for the password.');
  end if;
  if coalesce(pw, '') = '' and not exists (select 1 from public.share_passwords where desk_id = d) then
    return jsonb_build_object('ok', false, 'error', 'Set a password.');
  end if;
  if coalesce(pw, '') <> '' then perform public.set_share_password(d, pw); end if;
  begin
    update public.share_passwords set share_name = n where desk_id = d;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end;
  -- Saving is also how the student lifts a lock someone put on the desk by guessing.
  delete from public.share_join_failures where desk_id = d;
  select id, revoked_at into pw_link, pw_revoked from public.share_links where desk_id = d and via_password for update;
  if pw_link is null then
    insert into public.share_links (desk_id, token_hash, role, label, via_password)
    values (d, encode(gen_random_bytes(32), 'hex'), r, 'Desk name and password', true);
  else
    -- Turned off before: nobody who was in then comes back without the name and password.
    if pw_revoked is not null then delete from public.desk_members where link_id = pw_link; end if;
    update public.share_links set role = r, revoked_at = null where id = pw_link;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_desk_sharing(uuid, text, text, text) from public, anon;
grant execute on function public.set_desk_sharing(uuid, text, text, text) to authenticated;

-- Turn it off: the name stops working, and everyone who came in with it is removed. The password
-- stays, for the student's links.
create or replace function public.stop_desk_sharing(d uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  delete from public.desk_members m using public.share_links l
   where l.id = m.link_id and l.desk_id = d and l.via_password;
  update public.share_links set revoked_at = now() where desk_id = d and via_password and revoked_at is null;
  update public.share_passwords set share_name = null where desk_id = d;
end;
$$;
revoke all on function public.stop_desk_sharing(uuid) from public, anon;
grant execute on function public.stop_desk_sharing(uuid) to authenticated;

-- A signed-in (often anonymous) visitor opens a desk by its name and password. Returns
-- {ok, desk_id} or {ok:false, error}. A wrong name and a wrong password get the same answer, and
-- take as long. Ten wrong tries in 15 minutes stop a visitor; a hundred in an hour stop a desk.
create or replace function public.join_desk_by_name(desk_name text, pw text, member_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  me uuid := auth.uid();
  s public.share_passwords;
  pw_link uuid;
  nope constant jsonb := jsonb_build_object('ok', false, 'error', 'That desk name and password don''t match.');
  slow constant jsonb := jsonb_build_object('ok', false, 'error', 'Too many tries. Wait a few minutes and try again.');
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  delete from public.share_join_failures where at < now() - interval '1 day';
  if (select count(*) from public.share_join_failures where user_id = me and at > now() - interval '15 minutes') >= 10 then
    return slow;
  end if;
  select * into s from public.share_passwords where share_name = n;
  if s.desk_id is not null then
    select id into pw_link from public.share_links where desk_id = s.desk_id and via_password and revoked_at is null;
    if (select count(*) from public.share_join_failures where desk_id = s.desk_id and at > now() - interval '1 hour') >= 100 then
      return slow;
    end if;
  end if;
  if s.desk_id is null or pw_link is null then
    perform crypt(coalesce(pw, ''), gen_salt('bf'));
    insert into public.share_join_failures (user_id) values (me);
    return nope;
  end if;
  if pw is null or crypt(pw, s.hash) <> s.hash then
    insert into public.share_join_failures (user_id, desk_id) values (me, s.desk_id);
    return nope;
  end if;
  if public.is_desk_owner(s.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', s.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(member_name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (s.desk_id, me, pw_link, left(trim(member_name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', s.desk_id);
end;
$$;
revoke all on function public.join_desk_by_name(text, text, text) from public, anon;
grant execute on function public.join_desk_by_name(text, text, text) to authenticated;
