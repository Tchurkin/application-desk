-- Recommenders and their letters.
--
-- Braxton's call (9/24/26): the board is one master board, and beside each college it shows who
-- writes its letters, each recommender in a color of their own. The student adds recommenders
-- and says which colleges each one writes for; so can the counselor (a connector allowed to
-- manage colleges and pieces).

create table if not exists public.recommenders (
  id uuid primary key default gen_random_uuid(),
  desk_id uuid not null references public.desks(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null default '' check (char_length(role) <= 200),
  -- One of eight colors (the website's palette); picked on insert when not given.
  color smallint not null check (color between 0 and 7),
  created_at timestamptz not null default now()
);
create index if not exists recommenders_desk on public.recommenders (desk_id);

-- A letter one recommender writes for one college, and how far along it is.
create table if not exists public.letters (
  college_id uuid not null references public.colleges(id) on delete cascade,
  recommender_id uuid not null references public.recommenders(id) on delete cascade,
  desk_id uuid not null references public.desks(id) on delete cascade,
  status text not null default 'planned' check (status in ('planned','requested','submitted')),
  updated_at timestamptz not null default now(),
  primary key (college_id, recommender_id)
);
create index if not exists letters_desk on public.letters (desk_id);
create index if not exists letters_recommender on public.letters (recommender_id);

-- A new recommender gets the color the desk uses least (the first of those on a tie).
create or replace function public.recommender_color()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.color is null then
    select c into new.color
      from generate_series(0, 7) c
      left join public.recommenders r on r.desk_id = new.desk_id and r.color = c
     group by c
     order by count(r.id), c
     limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists recommender_color on public.recommenders;
create trigger recommender_color before insert on public.recommenders
  for each row execute function public.recommender_color();

-- A letter's college and recommender are on its own desk.
create or replace function public.letters_same_desk()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.colleges where id = new.college_id and desk_id = new.desk_id)
     or not exists (select 1 from public.recommenders where id = new.recommender_id and desk_id = new.desk_id) then
    raise exception 'That college and recommender aren''t both on this desk.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists letters_same_desk on public.letters;
create trigger letters_same_desk before insert or update on public.letters
  for each row execute function public.letters_same_desk();

alter table public.recommenders enable row level security;
alter table public.letters enable row level security;

drop policy if exists "read recommenders" on public.recommenders;
create policy "read recommenders" on public.recommenders
  for select using (public.can_read_desk(desk_id));
drop policy if exists "write recommenders" on public.recommenders;
create policy "write recommenders" on public.recommenders
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

drop policy if exists "read letters" on public.letters;
create policy "read letters" on public.letters
  for select using (public.can_read_desk(desk_id));
drop policy if exists "write letters" on public.letters;
create policy "write letters" on public.letters
  for all using (public.can_write_desk(desk_id)) with check (public.can_write_desk(desk_id));

-- The board follows them live (the counselor adding a recommender shows at once).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recommenders') then
    alter publication supabase_realtime add table public.recommenders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'letters') then
    alter publication supabase_realtime add table public.letters;
  end if;
end;
$$;

-- ─── through the connector ────────────────────────────────────────────────────

-- The desk's recommenders, each with the letters they write.
create or replace function public.connector_recommenders(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'role', r.role,
      'letters', coalesce((
        select jsonb_agg(jsonb_build_object('college_id', x.college_id, 'college', c.name, 'status', x.status) order by c.name)
          from public.letters x join public.colleges c on c.id = x.college_id
         where x.recommender_id = r.id), '[]'::jsonb)
    ) order by r.created_at)
    from public.recommenders r where r.desk_id = l.desk_id), '[]'::jsonb);
end;
$$;

-- Add a recommender (recommender null) or change one: fields {name, role}. Returns its id.
create or replace function public.connector_save_recommender(token text, recommender uuid, fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  rid uuid;
  n text := btrim(coalesce(fields->>'name', ''));
begin
  perform public.connector_allow(token, 'manage');
  if recommender is null then
    if n = '' then raise exception 'A recommender needs a name.'; end if;
    insert into public.recommenders (desk_id, name, role)
    values (l.desk_id, left(n, 120), left(coalesce(fields->>'role', ''), 200))
    returning id into rid;
  else
    update public.recommenders set
      name = case when n = '' then name else left(n, 120) end,
      role = left(coalesce(fields->>'role', role), 200)
     where id = recommender and desk_id = l.desk_id
    returning id into rid;
    if rid is null then raise exception 'That recommender isn''t on this desk.'; end if;
  end if;
  return rid;
end;
$$;

create or replace function public.connector_delete_recommender(token text, recommender uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  delete from public.recommenders where id = recommender and desk_id = l.desk_id;
  if not found then raise exception 'That recommender isn''t on this desk.'; end if;
end;
$$;

-- Say that a recommender writes for a college, and how far along the letter is; 'none' takes it off.
create or replace function public.connector_set_letter(token text, recommender uuid, college uuid, letter_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  if not exists (select 1 from public.recommenders where id = recommender and desk_id = l.desk_id) then
    raise exception 'That recommender isn''t on this desk.';
  end if;
  if not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'That college isn''t on this desk.';
  end if;
  if letter_status = 'none' then
    delete from public.letters where recommender_id = recommender and college_id = college;
  elsif letter_status in ('planned', 'requested', 'submitted') then
    insert into public.letters (college_id, recommender_id, desk_id, status)
    values (college, recommender, l.desk_id, letter_status)
    on conflict (college_id, recommender_id) do update set status = excluded.status;
  else
    raise exception 'A letter''s status is planned, requested, submitted or none.';
  end if;
end;
$$;

grant execute on function public.connector_recommenders(text) to anon, authenticated;
grant execute on function public.connector_save_recommender(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_recommender(text, uuid) to anon, authenticated;
grant execute on function public.connector_set_letter(text, uuid, uuid, text) to anon, authenticated;
