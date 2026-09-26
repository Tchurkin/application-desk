-- Files in the student's profile folder.
--
-- Braxton's call (9/26/26): the Profile page is a folder. Next to the notes (profile_sections),
-- the student can upload any file, such as a school's PDF form, for the counselor to read and fill
-- in. Files are kept in the database rather than file storage: the counselor reaches a desk only
-- through its connector token (it holds no storage key), and deleting the account deletes them
-- with everything else. Up to 5 MB each, 25 MB a desk.

create table if not exists public.profile_files (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  name       text not null check (length(name) between 1 and 200),
  mime       text not null default 'application/octet-stream' check (length(mime) <= 120),
  size       int not null check (size > 0 and size <= 5242880),
  -- '' when the student added it, else the assistant's label (a form it filled in).
  added_by   text not null default '' check (length(added_by) <= 80),
  created_at timestamptz not null default now()
);
create index if not exists profile_files_desk on public.profile_files (desk_id, created_at);

-- The bytes, apart, so listing files (and live updates about them) never carries them.
create table if not exists public.profile_file_data (
  file_id uuid primary key references public.profile_files (id) on delete cascade,
  data    bytea not null
);

alter table public.profile_files enable row level security;
alter table public.profile_file_data enable row level security;
drop policy if exists "owner sees files" on public.profile_files;
create policy "owner sees files" on public.profile_files for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner deletes files" on public.profile_files;
create policy "owner deletes files" on public.profile_files for delete using (public.is_desk_owner(desk_id));
-- No policies on profile_file_data: its bytes come and go only through the functions below.

-- The Profile page follows the list live (a form the counselor filled in shows at once).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'profile_files') then
    alter publication supabase_realtime add table public.profile_files;
  end if;
end;
$$;

-- Store a file on a desk, checking its size and the desk's room. Shared by the student's upload
-- and the connector.
create or replace function public.store_profile_file(d uuid, file_name text, file_mime text, b64 text, who text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  bytes bytea;
  new_id uuid;
begin
  bytes := decode(coalesce(b64, ''), 'base64');
  if length(bytes) = 0 then raise exception 'That file is empty.'; end if;
  if length(bytes) > 5242880 then raise exception 'That file is over 5 MB.'; end if;
  -- One upload at a time per desk, so two at once can't both fit under the limit.
  perform 1 from public.desks where id = d for update;
  if coalesce((select sum(size) from public.profile_files where desk_id = d), 0) + length(bytes) > 26214400 then
    raise exception 'Your files are full (25 MB). Delete some first.';
  end if;
  insert into public.profile_files (desk_id, name, mime, size, added_by)
  values (d, left(coalesce(nullif(trim(file_name), ''), 'Untitled'), 200), left(coalesce(nullif(trim(file_mime), ''), 'application/octet-stream'), 120), length(bytes), left(coalesce(who, ''), 80))
  returning profile_files.id into new_id;
  insert into public.profile_file_data (file_id, data) values (new_id, bytes);
  return new_id;
end;
$$;
revoke all on function public.store_profile_file(uuid, text, text, text, text) from public, anon, authenticated;

-- The student uploads a file.
create or replace function public.add_profile_file(d uuid, file_name text, file_mime text, b64 text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  return public.store_profile_file(d, file_name, file_mime, b64, '');
end;
$$;
revoke all on function public.add_profile_file(uuid, text, text, text) from public, anon;
grant execute on function public.add_profile_file(uuid, text, text, text) to authenticated;

-- The student opens (or downloads) one: {name, mime, b64}.
create or replace function public.profile_file_content(f uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pf public.profile_files;
begin
  select * into pf from public.profile_files where id = f;
  if not found or not public.is_desk_owner(pf.desk_id) then raise exception 'not allowed'; end if;
  return jsonb_build_object('name', pf.name, 'mime', pf.mime,
    'b64', (select replace(encode(data, 'base64'), chr(10), '') from public.profile_file_data where file_id = f));
end;
$$;
revoke all on function public.profile_file_content(uuid) from public, anon;
grant execute on function public.profile_file_content(uuid) to authenticated;

-- The connector: list, read and add files (the profile is always open to the student's assistant).
-- Not stable: connector_link notes when the link was used, which a read-only call can't do.
create or replace function public.connector_profile_files(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'mime', mime, 'size', size, 'added_by', added_by, 'created_at', created_at) order by created_at)
    from public.profile_files where desk_id = l.desk_id), '[]'::jsonb);
end;
$$;

create or replace function public.connector_profile_file(token text, f uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  pf public.profile_files;
begin
  select * into pf from public.profile_files where id = f and desk_id = l.desk_id;
  if not found then raise exception 'No file with that file_id on this desk: call read_profile for the list.'; end if;
  return jsonb_build_object('name', pf.name, 'mime', pf.mime, 'size', pf.size,
    'b64', (select replace(encode(data, 'base64'), chr(10), '') from public.profile_file_data where file_id = f));
end;
$$;

create or replace function public.connector_add_profile_file(token text, file_name text, file_mime text, b64 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return public.store_profile_file(l.desk_id, file_name, file_mime, b64, l.label);
end;
$$;

revoke all on function public.connector_profile_files(text) from public;
revoke all on function public.connector_profile_file(text, uuid) from public;
revoke all on function public.connector_add_profile_file(text, text, text, text) from public;
grant execute on function public.connector_profile_files(text) to anon, authenticated;
grant execute on function public.connector_profile_file(text, uuid) to anon, authenticated;
grant execute on function public.connector_add_profile_file(text, text, text, text) to anon, authenticated;
