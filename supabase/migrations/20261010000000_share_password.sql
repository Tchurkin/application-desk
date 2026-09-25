-- One password for all of a student's share links.
--
-- Braxton's call (9/24/26): instead of a password per link, the student sets one password (or
-- none) that every share link asks for the first time someone opens it on a device. Each person
-- still gets their own link, so what they can do, and cutting them off, stays per person. Someone
-- already in through their link isn't asked again. A link made earlier with its own password keeps
-- it until the student sets (or turns off) the desk's password, which then covers every link.

-- The hash lives apart from desks, which the people a desk is shared with can read.
create table if not exists public.share_passwords (
  desk_id    uuid primary key references public.desks (id) on delete cascade,
  hash       text not null,
  updated_at timestamptz not null default now()
);
alter table public.share_passwords enable row level security;
drop policy if exists "owner sees whether there is one" on public.share_passwords;
create policy "owner sees whether there is one" on public.share_passwords
  for select using (public.is_desk_owner(desk_id));

-- Set the password (at least 6 characters), or clear it with ''.
create or replace function public.set_share_password(d uuid, pw text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  -- From now on the desk's password is the only one: older links drop their own.
  update public.share_links
     set password_hash = null, failed_attempts = 0, locked_until = null
   where desk_id = d and password_hash is not null;
  if coalesce(pw, '') = '' then
    delete from public.share_passwords where desk_id = d;
    return;
  end if;
  if length(pw) < 6 then raise exception 'Use at least 6 characters for the password.'; end if;
  insert into public.share_passwords (desk_id, hash) values (d, crypt(pw, gen_salt('bf')))
  on conflict (desk_id) do update set hash = excluded.hash, updated_at = now();
end;
$$;
revoke all on function public.set_share_password(uuid, text) from public, anon;
grant execute on function public.set_share_password(uuid, text) to authenticated;

-- The password a link asks for: its own (links made before this), else the desk's; none for
-- someone already in through this very link.
create or replace function public.link_password_hash(l public.share_links)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.desk_members m where m.desk_id = l.desk_id and m.user_id = auth.uid() and m.link_id = l.id)
      then null
    else coalesce(l.password_hash, (select s.hash from public.share_passwords s where s.desk_id = l.desk_id))
  end;
$$;
revoke all on function public.link_password_hash(public.share_links) from public, anon, authenticated;

-- Anyone holding a token: what it opens, without joining.
create or replace function public.link_info(token text)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  l public.share_links;
  title text;
begin
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then return jsonb_build_object('valid', false); end if;
  select d.title into title from public.desks d where d.id = l.desk_id;
  return jsonb_build_object(
    'valid', true,
    'role', l.role,
    'needs_password', public.link_password_hash(l) is not null,
    'desk_title', title
  );
end;
$$;

-- A signed-in (often anonymous) visitor joins through a link. Returns {ok, desk_id} or
-- {ok:false, error}. Errors are returned, not raised, so failed attempts are counted.
create or replace function public.join_desk(token text, link_password text, name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.share_links;
  h text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  select * into l from public.share_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'This link is no longer valid.');
  end if;
  if l.locked_until is not null and l.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Too many wrong passwords. Try again in a few minutes.');
  end if;
  h := public.link_password_hash(l);
  if h is not null and (link_password is null or crypt(link_password, h) <> h) then
    update public.share_links
       set failed_attempts = case when failed_attempts + 1 >= 10 then 0 else failed_attempts + 1 end,
           locked_until    = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' else locked_until end
     where id = l.id;
    return jsonb_build_object('ok', false, 'error', 'Wrong password.');
  end if;
  if public.is_desk_owner(l.desk_id) then
    return jsonb_build_object('ok', true, 'desk_id', l.desk_id, 'owner', true);
  end if;
  if length(trim(coalesce(name, ''))) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name.');
  end if;
  update public.share_links set failed_attempts = 0 where id = l.id;
  insert into public.desk_members (desk_id, user_id, link_id, display_name)
  values (l.desk_id, auth.uid(), l.id, left(trim(name), 80))
  on conflict (desk_id, user_id) do update
    set link_id = excluded.link_id, display_name = excluded.display_name;
  return jsonb_build_object('ok', true, 'desk_id', l.desk_id);
end;
$$;
revoke all on function public.join_desk(text, text, text) from public, anon;
grant execute on function public.join_desk(text, text, text) to authenticated;
