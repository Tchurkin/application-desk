-- Application Desk: milestone 2 (parents).
--
-- A student shares their desk through links. Someone who opens a link signs in anonymously,
-- enters a name, and becomes a member with the link's role: 'view' reads, 'suggest' also
-- proposes edits. Revoking a link ends every membership made through it at once.
--
-- Suggestions live in their own table. Members can never write a piece's text (piece_updates
-- stays owner-only), so the student's words change only when the student accepts something.

-- ─── share links and members ─────────────────────────────────────────────────

create table public.share_links (
  id              uuid primary key default gen_random_uuid(),
  desk_id         uuid not null references public.desks (id) on delete cascade,
  -- sha256 of the token in the URL; the token itself is shown once and never stored.
  token_hash      text not null unique,
  role            text not null check (role in ('view','suggest')),
  label           text not null default '' check (length(label) <= 80),
  -- bcrypt, or null for no password.
  password_hash   text,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  revoked_at      timestamptz
);
create index share_links_desk_idx on public.share_links (desk_id);

create table public.desk_members (
  desk_id      uuid not null references public.desks (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  link_id      uuid not null references public.share_links (id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  joined_at    timestamptz not null default now(),
  primary key (desk_id, user_id)
);

-- The caller's role on a desk through a live link: 'view', 'suggest', or null.
create or replace function public.member_role(d uuid)
returns text language sql stable security definer set search_path = public as $$
  select l.role
    from public.desk_members m
    join public.share_links l on l.id = m.link_id
   where m.desk_id = d and m.user_id = auth.uid() and l.revoked_at is null
   limit 1;
$$;

create or replace function public.is_desk_owner(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

create or replace function public.can_read_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) is not null;
$$;

-- Writing the essay text and the desk itself stays with the owner.
create or replace function public.can_write_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d);
$$;

create or replace function public.can_suggest_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'suggest';
$$;

-- Anonymous visitors (parents on a link) get no desk of their own.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

-- Owner: make a link. Returns the token, which is only ever seen here.
create or replace function public.create_share_link(d uuid, link_role text, link_label text, link_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if link_role not in ('view','suggest') then raise exception 'bad role'; end if;
  token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.share_links (desk_id, token_hash, role, label, password_hash)
  values (
    d,
    encode(digest(token, 'sha256'), 'hex'),
    link_role,
    left(coalesce(link_label, ''), 80),
    case when coalesce(link_password, '') = '' then null else crypt(link_password, gen_salt('bf')) end
  );
  return token;
end;
$$;

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
    'needs_password', l.password_hash is not null,
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
  if l.password_hash is not null
     and (link_password is null or crypt(link_password, l.password_hash) <> l.password_hash) then
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

-- The desks the caller can open as a member, for the home page.
create or replace function public.my_shared_desks()
returns table (desk_id uuid, title text, role text)
language sql stable security definer set search_path = public as $$
  select d.id, d.title, l.role
    from public.desk_members m
    join public.share_links l on l.id = m.link_id and l.revoked_at is null
    join public.desks d on d.id = m.desk_id
   where m.user_id = auth.uid()
   order by m.joined_at desc;
$$;

alter table public.share_links  enable row level security;
alter table public.desk_members enable row level security;

create policy "owner reads links" on public.share_links
  for select using (public.is_desk_owner(desk_id));
create policy "owner revokes links" on public.share_links
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
create policy "owner deletes links" on public.share_links
  for delete using (public.is_desk_owner(desk_id));

create policy "owner and self read members" on public.desk_members
  for select using (public.is_desk_owner(desk_id) or user_id = auth.uid());
create policy "owner removes members" on public.desk_members
  for delete using (public.is_desk_owner(desk_id));

-- Members can read the desk's title.
drop policy if exists "read desk" on public.desks;
create policy "read desk" on public.desks
  for select using (public.can_read_desk(id));

revoke all on function public.create_share_link(uuid, text, text, text) from public, anon;
grant execute on function public.create_share_link(uuid, text, text, text) to authenticated;
revoke all on function public.join_desk(text, text, text) from public, anon;
grant execute on function public.join_desk(text, text, text) to authenticated;
grant execute on function public.link_info(text) to anon, authenticated;
revoke all on function public.my_shared_desks() from public, anon;
grant execute on function public.my_shared_desks() to authenticated;

-- ─── suggestions ─────────────────────────────────────────────────────────────

create table public.suggestions (
  -- Chosen by the client so a suggestion can be drawn before the server has it.
  id          uuid primary key,
  piece_id    uuid not null references public.pieces (id) on delete cascade,
  author_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default '' check (length(author_name) <= 80),
  -- 'ai' suggestions stay flagged (provenance) until the student rewrites them.
  source      text not null default 'person' check (source in ('person','ai')),
  kind        text not null check (kind in ('insert','delete','replace')),
  -- Yjs relative positions (base64). Insert: anchor_from only. Delete/replace: the range.
  anchor_from text not null,
  anchor_to   text,
  -- The text being deleted, as it read when suggested (to spot later edits).
  quote       text not null default '',
  -- The text being inserted.
  body        text not null default '',
  status      text not null default 'open' check (status in ('open','accepted','declined')),
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);
create index suggestions_piece_idx on public.suggestions (piece_id, status);

-- Owners only resolve; authors only edit their own open suggestions.
create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) and old.author_id <> auth.uid() then
    if new.kind <> old.kind or new.anchor_from <> old.anchor_from
       or new.anchor_to is distinct from old.anchor_to
       or new.quote <> old.quote or new.body <> old.body then
      raise exception 'the student accepts or declines, and does not edit, a suggestion';
    end if;
    new.resolved_at := case when new.status = 'open' then null else now() end;
    new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
  elsif old.author_id = auth.uid() then
    if old.status <> 'open' or new.status <> 'open' then
      raise exception 'only the student resolves a suggestion';
    end if;
  else
    raise exception 'not allowed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger suggestions_check_update
  before update on public.suggestions
  for each row execute function public.check_suggestion_update();

alter table public.suggestions enable row level security;

create policy "read suggestions" on public.suggestions
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "make suggestions" on public.suggestions
  for insert with check (
    author_id = auth.uid() and status = 'open'
    and public.can_suggest_desk(public.piece_desk(piece_id))
  );
create policy "edit or resolve suggestions" on public.suggestions
  for update using (
    (author_id = auth.uid() and public.can_suggest_desk(public.piece_desk(piece_id)))
    or public.is_desk_owner(public.piece_desk(piece_id))
  );
create policy "withdraw own suggestions" on public.suggestions
  for delete using (author_id = auth.uid() and status = 'open');

-- ─── realtime ────────────────────────────────────────────────────────────────

-- Row changes stream to subscribers, filtered by the policies above.
alter publication supabase_realtime add table public.piece_updates, public.suggestions;

-- Live cursors travel on a private channel per piece ("piece:<uuid>") that only people
-- who can read the piece may join.
create or replace function public.can_use_piece_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic !~ '^piece:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return public.can_read_desk(public.piece_desk(substring(topic from 7)::uuid));
end;
$$;

create policy "piece channel: listen" on realtime.messages
  for select to authenticated using (public.can_use_piece_topic(realtime.topic()));
create policy "piece channel: send" on realtime.messages
  for insert to authenticated with check (public.can_use_piece_topic(realtime.topic()));
