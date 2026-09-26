-- Sharing by name: fixes from review.
--
-- 1. A desk that many wrong tries have stopped still lets in a visitor who hasn't got anything
--    wrong: otherwise one person with a stack of throwaway sessions could keep the right password
--    out for as long as they liked. A guesser gets one try per fresh session while it lasts.
-- 2. The student is told when someone has been guessing (desk_share_guesses), so they can change
--    the name, the lasting fix.
-- 3. A name that turns out to be taken no longer saves the new password anyway.

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
  -- Together, so a name taken in the meantime leaves the password as it was too.
  begin
    if coalesce(pw, '') <> '' then perform public.set_share_password(d, pw); end if;
    update public.share_passwords set share_name = n where desk_id = d;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'That desk name is taken. Try another.');
  end;
  -- Saving is also how the student lifts a stop someone put on the desk by guessing.
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

-- A signed-in (often anonymous) visitor opens a desk by its name and password. Returns
-- {ok, desk_id} or {ok:false, error}. A wrong name and a wrong password get the same answer, and
-- take as long. Ten wrong tries in 15 minutes stop a visitor. A hundred in an hour on one desk stop
-- anyone who has got one wrong in that hour from trying it again, but not someone new.
create or replace function public.join_desk_by_name(desk_name text, pw text, member_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  n text := lower(trim(coalesce(desk_name, '')));
  me uuid := auth.uid();
  s public.share_passwords;
  pw_link uuid;
  nope constant jsonb := jsonb_build_object('ok', false, 'error', 'That desk name and password don''t match.');
  slow constant jsonb := jsonb_build_object('ok', false, 'error', 'Too many tries. Wait a while and try again.');
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  delete from public.share_join_failures where at < now() - interval '1 day';
  if (select count(*) from public.share_join_failures where user_id = me and at > now() - interval '15 minutes') >= 10 then
    return slow;
  end if;
  select * into s from public.share_passwords where share_name = n;
  if s.desk_id is not null then
    select id into pw_link from public.share_links where desk_id = s.desk_id and via_password and revoked_at is null;
    if (select count(*) from public.share_join_failures where desk_id = s.desk_id and at > now() - interval '1 hour') >= 100
       and exists (select 1 from public.share_join_failures where user_id = me and at > now() - interval '1 hour') then
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

-- How many wrong passwords have been tried on the student's desk by its name in the last day
-- (since they last saved their sharing settings).
create or replace function public.desk_share_guesses(d uuid)
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  return (select count(*) from public.share_join_failures where desk_id = d and at > now() - interval '1 day');
end;
$$;
revoke all on function public.desk_share_guesses(uuid) from public, anon;
grant execute on function public.desk_share_guesses(uuid) to authenticated;
