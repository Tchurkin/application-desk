-- Application Desk: milestone 1 schema (one student, working alone).
--
-- Every table has row-level security. Access runs through two helpers,
-- can_read_desk() and can_write_desk(), so later milestones (parents, share links)
-- widen access in one place.

create extension if not exists pgcrypto;

-- ─── profiles and desks ──────────────────────────────────────────────────────

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default '',
  -- Free-text profile the student writes about themself (used later as AI context).
  about         text not null default '',
  last_piece_id uuid,
  created_at    timestamptz not null default now()
);

create table public.desks (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null unique references auth.users (id) on delete cascade,
  title      text not null default 'My application desk',
  created_at timestamptz not null default now()
);

create or replace function public.can_read_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

create or replace function public.can_write_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.desks where id = d and owner_id = auth.uid());
$$;

-- A new account gets a profile and a desk.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── colleges ────────────────────────────────────────────────────────────────

create table public.colleges (
  id                 uuid primary key default gen_random_uuid(),
  desk_id            uuid not null references public.desks (id) on delete cascade,
  name               text not null check (length(name) between 1 and 200),
  app_system         text not null default 'common_app' check (app_system in
                       ('common_app','coalition','uc','applytexas','ucas','questbridge','own_portal','other')),
  round              text not null default 'RD' check (round in
                       ('ED','ED2','EA','REA','RD','rolling','priority')),
  deadline           date,
  materials_deadline date,
  -- 'no_drafting': the AI counselor may ask questions and check facts but writes no sentences.
  ai_policy          text not null default 'allowed' check (ai_policy in ('allowed','no_drafting')),
  needs_letters      boolean not null default true,
  research           text not null default '',
  created_at         timestamptz not null default now()
);
create index colleges_desk_idx on public.colleges (desk_id);

-- ─── pieces of writing ───────────────────────────────────────────────────────

create table public.pieces (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null references public.desks (id) on delete cascade,
  -- null = not tied to one college (e.g. the Common App personal essay)
  college_id  uuid references public.colleges (id) on delete cascade,
  title       text not null default 'Untitled' check (length(title) <= 300),
  prompt      text not null default '',
  limit_kind  text not null default 'words' check (limit_kind in ('words','chars','none')),
  limit_value integer check (limit_value is null or limit_value > 0),
  status      text not null default 'not_started' check (status in
                ('not_started','drafting','needs_review','final','submitted')),
  -- Notes live outside the essay text and are never counted.
  notes       text not null default '',
  -- Compacted Yjs state (base64). Recent edits live in piece_updates until compacted.
  doc_state   text not null default '',
  -- Derived from the document for the board and search; the Yjs state is the truth.
  plain_text  text not null default '',
  word_count  integer not null default 0,
  char_count  integer not null default 0,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pieces_desk_idx on public.pieces (desk_id);
create index pieces_college_idx on public.pieces (college_id);

-- A piece's college must belong to the same desk.
create or replace function public.check_piece_college()
returns trigger language plpgsql as $$
begin
  if new.college_id is not null and not exists (
    select 1 from public.colleges c where c.id = new.college_id and c.desk_id = new.desk_id
  ) then
    raise exception 'college % is not on desk %', new.college_id, new.desk_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger pieces_check_college
  before insert or update on public.pieces
  for each row execute function public.check_piece_college();

create or replace function public.piece_desk(p uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select desk_id from public.pieces where id = p;
$$;

-- Append-only Yjs updates. Each screen inserts only its own edits; any order of arrival,
-- duplicates included, merges to the same document. Inserting against a deleted piece
-- fails on the foreign key, so a late writer can never recreate a deleted piece.
create table public.piece_updates (
  id         bigint generated always as identity primary key,
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  client_id  text not null,
  "update"   text not null,
  created_at timestamptz not null default now()
);
create index piece_updates_piece_idx on public.piece_updates (piece_id, id);

-- Saved versions, thinned by age on the client (see src/lib/domain/history.ts).
create table public.piece_versions (
  id         uuid primary key default gen_random_uuid(),
  piece_id   uuid not null references public.pieces (id) on delete cascade,
  at         timestamptz not null default now(),
  author     text not null default '',
  content    jsonb not null,
  plain_text text not null default '',
  words      integer not null default 0,
  size       integer not null default 0
);
create index piece_versions_piece_idx on public.piece_versions (piece_id, at);

-- Fold settled updates into pieces.doc_state. The caller merged doc_state with every
-- update up to through_id; only updates older than the cutoff are deleted, so an update
-- that committed late (lower id, later commit) is never dropped unmerged.
create or replace function public.compact_piece(p uuid, state text, through_id bigint, cutoff timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_write_desk(public.piece_desk(p)) then
    raise exception 'not allowed';
  end if;
  update public.pieces set doc_state = state where id = p;
  delete from public.piece_updates
    where piece_id = p and id <= through_id and created_at < cutoff;
end;
$$;

-- ─── delete my data ──────────────────────────────────────────────────────────

-- Deletes the caller's account; every table above cascades from auth.users.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ─── row-level security ──────────────────────────────────────────────────────

alter table public.profiles       enable row level security;
alter table public.desks          enable row level security;
alter table public.colleges       enable row level security;
alter table public.pieces         enable row level security;
alter table public.piece_updates  enable row level security;
alter table public.piece_versions enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "read desk" on public.desks
  for select using (public.can_read_desk(id));
create policy "rename desk" on public.desks
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "read colleges" on public.colleges
  for select using (public.can_read_desk(desk_id));
create policy "write colleges" on public.colleges
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

create policy "read pieces" on public.pieces
  for select using (public.can_read_desk(desk_id));
create policy "write pieces" on public.pieces
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

create policy "read updates" on public.piece_updates
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "add updates" on public.piece_updates
  for insert with check (public.can_write_desk(public.piece_desk(piece_id)));

create policy "read versions" on public.piece_versions
  for select using (public.can_read_desk(public.piece_desk(piece_id)));
create policy "write versions" on public.piece_versions
  for all using (public.can_write_desk(public.piece_desk(piece_id)))
  with check (public.can_write_desk(public.piece_desk(piece_id)));

revoke all on function public.compact_piece(uuid, text, bigint, timestamptz) from public, anon;
grant execute on function public.compact_piece(uuid, text, bigint, timestamptz) to authenticated;
