-- Permissions, the counselor, the Profile page, and due dates through the connector.
--
-- Braxton's calls (9/24/26):
-- - Share links pick one of three levels: read only, suggest, or edit (edit can also suggest).
-- - Each connector (Claude, ChatGPT, the counselor) has its own level for essays (read, suggest,
--   edit) and a separate switch for managing the desk: adding, changing and removing colleges
--   and pieces, prompts, limits and due dates.
-- - A counselor can run on the student's own computer: a small watcher picks up requests from
--   the website and wakes Claude Code to answer them, with nothing for the student to do.
-- - A Profile page: sections about the student, written by them or by Claude (for example after
--   Claude interviews them), used as context for every essay.

-- ─── share links: read only, suggest, or edit ────────────────────────────────

alter table public.share_links drop constraint if exists share_links_role_check;
alter table public.share_links add constraint share_links_role_check check (role in ('view','suggest','edit'));

create or replace function public.can_suggest_desk(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) in ('suggest','edit');
$$;

-- Who may change a piece's text directly: the student, and people on an "edit" link.
create or replace function public.can_edit_text(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'edit';
$$;

drop policy if exists "add updates" on public.piece_updates;
create policy "add updates" on public.piece_updates
  for insert with check (public.can_edit_text(public.piece_desk(piece_id)));

create or replace function public.create_share_link(d uuid, link_role text, link_label text, link_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  if link_role not in ('view','suggest','edit') then raise exception 'bad role'; end if;
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

-- ─── connector permissions ───────────────────────────────────────────────────

-- Existing links keep doing everything they did.
alter table public.connector_links
  add column if not exists essay_access text not null default 'edit' check (essay_access in ('read','suggest','edit')),
  add column if not exists can_manage boolean not null default true;

-- Raise a clear error when the student hasn't allowed this connector to do `what`
-- ('suggest', 'edit' or 'manage').
create or replace function public.connector_allow(token text, what text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  if what = 'manage' and not l.can_manage then
    raise exception 'The student hasn''t allowed % to add, change or remove colleges and pieces (details, prompts, limits, due dates). Tell them what you would change; they can allow it in Application Desk → Settings.', l.label;
  elsif what = 'edit' and l.essay_access <> 'edit' then
    raise exception 'The student hasn''t allowed % to change essay text directly.%', l.label,
      case when l.essay_access = 'suggest' then ' Use suggest_edits instead: the changes wait for them to accept.' else ' Give advice in your answer instead.' end;
  elsif what = 'suggest' and l.essay_access = 'read' then
    raise exception 'The student has allowed % to read their essays but not to suggest edits. Give advice in your answer instead.', l.label;
  end if;
end;
$$;
revoke all on function public.connector_allow(text, text) from public, anon, authenticated;

-- The checked functions keep their names; the originals move aside, callable only from here.
do $$
declare
  f record;
begin
  for f in select * from (values
    ('connector_write', 'text, uuid, text, jsonb, text, text, integer, integer'),
    ('connector_add_suggestions', 'text, uuid, jsonb'),
    ('connector_create_piece', 'text, uuid, text, text, text, integer'),
    ('connector_update_college', 'text, uuid, jsonb'),
    ('connector_delete_college', 'text, uuid'),
    ('connector_delete_piece', 'text, uuid')
  ) as t(name, args) loop
    if to_regprocedure(format('public.%s_unchecked(%s)', f.name, f.args)) is null then
      execute format('alter function public.%s(%s) rename to %s_unchecked', f.name, f.args, f.name);
    end if;
    execute format('revoke all on function public.%s_unchecked(%s) from public, anon, authenticated', f.name, f.args);
  end loop;
end;
$$;

create or replace function public.connector_write(
  token text, piece uuid, yjs_update text,
  before_json jsonb, before_text text, after_text text, after_words integer, after_chars integer
)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'edit');
  perform public.connector_write_unchecked(token, piece, yjs_update, before_json, before_text, after_text, after_words, after_chars);
end;
$$;

create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'suggest');
  return public.connector_add_suggestions_unchecked(token, piece, rows);
end;
$$;

create or replace function public.connector_create_piece(
  token text, college uuid, piece_title text, piece_prompt text, piece_limit_kind text, piece_limit_value integer
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  return public.connector_create_piece_unchecked(token, college, piece_title, piece_prompt, piece_limit_kind, piece_limit_value);
end;
$$;

create or replace function public.connector_update_college(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_update_college_unchecked(token, college, fields);
end;
$$;

create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_delete_college_unchecked(token, college);
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.connector_allow(token, 'manage');
  perform public.connector_delete_piece_unchecked(token, piece);
end;
$$;

-- ─── set up colleges: fill in what's missing on colleges and pieces already there ──

-- colleges: [{name, app_system, round, deadline, materials_deadline, needs_letters, ai_policy,
--             research, pieces: [{title, prompt, limit_kind, limit_value, due}]}]
-- A college or piece already on the desk (same name / title) is kept and updated with the details
-- sent: prompts, limits, due dates, deadlines. Research notes are only filled in when empty.
-- Returns [{name, college_id, created, pieces: [{title, piece_id, created}]}].
create or replace function public.connector_set_up_colleges(token text, colleges jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  c jsonb;
  p jsonb;
  cid uuid;
  pid uuid;
  made boolean;
  pmade boolean;
  result jsonb := '[]'::jsonb;
  pout jsonb;
  cname text;
  ptitle text;
  lim integer;
begin
  perform public.connector_allow(token, 'manage');
  if jsonb_typeof(colleges) <> 'array' or jsonb_array_length(colleges) = 0 then
    raise exception 'Send at least one college.';
  end if;
  for c in select * from jsonb_array_elements(colleges) loop
    cname := left(trim(coalesce(c ->> 'name', '')), 200);
    if cname = '' then raise exception 'Every college needs a name.'; end if;
    select id into cid from public.colleges where desk_id = l.desk_id and lower(name) = lower(cname) limit 1;
    made := cid is null;
    if made then
      insert into public.colleges (desk_id, name, app_system, round, deadline, materials_deadline, ai_policy, needs_letters, research)
      values (
        l.desk_id, cname,
        public.connector_app_system(c ->> 'app_system', 'common_app'),
        public.connector_round(c ->> 'round', 'RD'),
        public.connector_date(c ->> 'deadline'),
        public.connector_date(c ->> 'materials_deadline'),
        case when c ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end,
        coalesce((c ->> 'needs_letters')::boolean, true),
        coalesce(c ->> 'research', '')
      )
      returning id into cid;
    else
      update public.colleges set
        app_system = case when c ? 'app_system' then public.connector_app_system(c ->> 'app_system', app_system) else app_system end,
        round = case when c ? 'round' then public.connector_round(c ->> 'round', round) else round end,
        deadline = case when coalesce(c ->> 'deadline', '') <> '' then public.connector_date(c ->> 'deadline') else deadline end,
        materials_deadline = case when coalesce(c ->> 'materials_deadline', '') <> '' then public.connector_date(c ->> 'materials_deadline') else materials_deadline end,
        ai_policy = case when c ? 'ai_policy' then (case when c ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end) else ai_policy end,
        needs_letters = case when c ? 'needs_letters' then (c ->> 'needs_letters')::boolean else needs_letters end,
        research = case when research = '' and coalesce(c ->> 'research', '') <> '' then c ->> 'research' else research end
      where id = cid;
    end if;
    pout := '[]'::jsonb;
    if jsonb_typeof(c -> 'pieces') = 'array' then
      for p in select * from jsonb_array_elements(c -> 'pieces') loop
        ptitle := coalesce(nullif(left(trim(coalesce(p ->> 'title', '')), 300), ''), 'Untitled');
        lim := case when (p ->> 'limit_value')::integer > 0 then (p ->> 'limit_value')::integer else null end;
        select id into pid from public.pieces
         where desk_id = l.desk_id and college_id = cid and lower(title) = lower(ptitle) limit 1;
        pmade := pid is null;
        if pmade then
          insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value, due)
          values (
            l.desk_id, cid, ptitle, coalesce(p ->> 'prompt', ''),
            case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                 when lim is not null then 'words' else 'none' end,
            lim,
            public.connector_date(p ->> 'due')
          )
          returning id into pid;
        else
          update public.pieces set
            prompt = case when coalesce(p ->> 'prompt', '') <> '' then p ->> 'prompt' else prompt end,
            limit_kind = case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                              when lim is not null and limit_kind = 'none' then 'words' else limit_kind end,
            limit_value = coalesce(lim, limit_value),
            due = case when coalesce(p ->> 'due', '') <> '' then public.connector_date(p ->> 'due') else due end
          where id = pid;
        end if;
        pout := pout || jsonb_build_object('title', ptitle, 'piece_id', pid, 'created', pmade);
      end loop;
    end if;
    result := result || jsonb_build_object('name', cname, 'college_id', cid, 'created', made, 'pieces', pout);
  end loop;
  return result;
end;
$$;

-- fields: any of {title, prompt, limit_kind, limit_value, status, notes, college_id, due}
-- (college_id null moves it to the shared pieces; due "" clears the due date).
create or replace function public.connector_update_piece(token text, piece uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  new_college uuid;
begin
  perform public.connector_allow(token, 'manage');
  select * into p from public.pieces where id = piece and desk_id = l.desk_id for update;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  new_college := p.college_id;
  if fields ? 'college_id' then
    new_college := nullif(fields ->> 'college_id', '')::uuid;
    if new_college is not null and not exists (select 1 from public.colleges where id = new_college and desk_id = l.desk_id) then
      raise exception 'No college with that id on this desk.';
    end if;
  end if;
  update public.pieces set
    title = case when fields ? 'title' and trim(fields ->> 'title') <> '' then left(trim(fields ->> 'title'), 300) else title end,
    prompt = case when fields ? 'prompt' then coalesce(fields ->> 'prompt', '') else prompt end,
    limit_kind = case when fields ->> 'limit_kind' in ('words','chars','none') then fields ->> 'limit_kind'
                      when (fields ->> 'limit_value')::integer > 0 and limit_kind = 'none' then 'words' else limit_kind end,
    limit_value = case when fields ? 'limit_value' then (case when (fields ->> 'limit_value')::integer > 0 then (fields ->> 'limit_value')::integer else null end) else limit_value end,
    status = case when fields ->> 'status' in ('not_started','drafting','needs_review','final','submitted') then fields ->> 'status' else status end,
    notes = case when fields ? 'notes' then coalesce(fields ->> 'notes', '') else notes end,
    due = case when fields ? 'due' then public.connector_date(fields ->> 'due') else due end,
    college_id = new_college
  where id = p.id;
end;
$$;

-- The desk overview, with each piece's due date and what this connector is allowed to do.
create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'permissions', jsonb_build_object('essays', l.essay_access, 'manage', l.can_manage),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'profile_sections', (select count(*) from public.profile_sections s where s.desk_id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'app_system', c.app_system, 'round', c.round,
        'deadline', c.deadline, 'materials_deadline', c.materials_deadline,
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters,
        'has_research', length(c.research) > 0) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status, 'prompt', p.prompt,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value, 'due', p.due)
        order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

-- ─── the profile ─────────────────────────────────────────────────────────────

create table if not exists public.profile_sections (
  id         uuid primary key default gen_random_uuid(),
  desk_id    uuid not null references public.desks (id) on delete cascade,
  title      text not null default '' check (length(title) <= 200),
  body       text not null default '' check (length(body) <= 20000),
  sort       double precision not null default 0,
  -- '' when the student wrote it last, else the assistant's label.
  updated_by text not null default '' check (length(updated_by) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profile_sections_desk_idx on public.profile_sections (desk_id, sort);

alter table public.profile_sections enable row level security;
drop policy if exists "owner reads profile" on public.profile_sections;
create policy "owner reads profile" on public.profile_sections
  for select using (public.is_desk_owner(desk_id));
drop policy if exists "owner adds to profile" on public.profile_sections;
create policy "owner adds to profile" on public.profile_sections
  for insert with check (public.is_desk_owner(desk_id));
drop policy if exists "owner changes profile" on public.profile_sections;
create policy "owner changes profile" on public.profile_sections
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
drop policy if exists "owner removes from profile" on public.profile_sections;
create policy "owner removes from profile" on public.profile_sections
  for delete using (public.is_desk_owner(desk_id));

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profile_sections') then
    alter publication supabase_realtime add table public.profile_sections;
  end if;
end;
$$;

-- Everything on the Profile page, for the assistant.
create or replace function public.connector_profile(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'body', s.body, 'updated_at', s.updated_at)
                       order by s.sort, s.created_at)
      from public.profile_sections s where s.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

-- Add a section (section null; it goes last) or change one. fields: any of {title, body}.
create or replace function public.connector_save_profile_section(token text, section uuid, fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  sid uuid := section;
begin
  if length(coalesce(fields ->> 'body', '')) > 20000 then
    raise exception 'A section holds at most 20,000 characters. Split it into more sections.';
  end if;
  if sid is null then
    insert into public.profile_sections (desk_id, title, body, sort, updated_by)
    values (
      l.desk_id, left(trim(coalesce(fields ->> 'title', '')), 200), coalesce(fields ->> 'body', ''),
      coalesce((select max(sort) from public.profile_sections where desk_id = l.desk_id), 0) + 1,
      l.label
    )
    returning id into sid;
  else
    update public.profile_sections set
      title = case when fields ? 'title' then left(trim(coalesce(fields ->> 'title', '')), 200) else title end,
      body = case when fields ? 'body' then coalesce(fields ->> 'body', '') else body end,
      updated_by = l.label,
      updated_at = now()
    where id = sid and desk_id = l.desk_id;
    if not found then raise exception 'No profile section with that id. Call read_profile to see the sections.'; end if;
  end if;
  return sid;
end;
$$;

create or replace function public.connector_delete_profile_section(token text, section uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.profile_sections where id = section and desk_id = l.desk_id;
  if not found then raise exception 'No profile section with that id. Call read_profile to see the sections.'; end if;
end;
$$;

-- Put the sections in this order; any left out keep their order after them.
create or replace function public.connector_order_profile(token text, ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  with ranked as (
    select s.id, row_number() over (order by coalesce(array_position(ids, s.id), 1000000), s.sort, s.created_at) as n
      from public.profile_sections s where s.desk_id = l.desk_id
  )
  update public.profile_sections s set sort = r.n from ranked r where s.id = r.id;
end;
$$;

-- ─── the counselor, and interviews ───────────────────────────────────────────

-- An interview: the student's reply (or "start") on the Profile page, answered with the next question.
alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check check (kind in ('ask','polish','odds','interview'));

-- When the counselor picked a request up, so each wakes Claude once.
alter table public.desk_requests add column if not exists counselor_at timestamptz;
-- When a counselor on the student's computer last checked in.
alter table public.connector_links add column if not exists counselor_at timestamptz;

-- The counselor's watcher calls this every few seconds. It marks the link as watching, takes the
-- requests that arrived since, and says how many are new and how many are still waiting.
create or replace function public.connector_counselor_poll(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  fresh integer;
  waiting integer;
begin
  update public.connector_links set watched_at = now(), counselor_at = now()
   where id = l.id and (counselor_at is null or counselor_at < now() - interval '20 seconds');
  with taken as (
    update public.desk_requests set counselor_at = now()
     where desk_id = l.desk_id and status = 'pending' and counselor_at is null
    returning 1
  )
  select count(*) into fresh from taken;
  select count(*) into waiting from public.desk_requests where desk_id = l.desk_id and status = 'pending';
  return jsonb_build_object('fresh', fresh, 'waiting', waiting);
end;
$$;

-- ─── grants ──────────────────────────────────────────────────────────────────

grant execute on function public.connector_write(text, uuid, text, jsonb, text, text, integer, integer) to anon, authenticated;
grant execute on function public.connector_add_suggestions(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_create_piece(text, uuid, text, text, text, integer) to anon, authenticated;
grant execute on function public.connector_update_college(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_college(text, uuid) to anon, authenticated;
grant execute on function public.connector_delete_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_set_up_colleges(text, jsonb) to anon, authenticated;
grant execute on function public.connector_update_piece(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_desk(text) to anon, authenticated;
grant execute on function public.connector_profile(text) to anon, authenticated;
grant execute on function public.connector_save_profile_section(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_profile_section(text, uuid) to anon, authenticated;
grant execute on function public.connector_order_profile(text, uuid[]) to anon, authenticated;
grant execute on function public.connector_counselor_poll(text) to anon, authenticated;
