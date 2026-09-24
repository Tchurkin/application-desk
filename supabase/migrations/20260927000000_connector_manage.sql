-- The connector can set up and manage the whole desk.
--
-- A student pastes the list of colleges they're applying to, and Claude or ChatGPT adds each
-- college with its system, round and deadlines, and a piece for every supplemental prompt.
-- It can also change or remove colleges and pieces, and update the student's profile.
-- Everything is keyed by the connector token, like the other connector functions.

-- ─── suggestions keep the text just before an insertion ───────────────────────

-- When paragraphs are joined, split or restructured, the editor re-creates the moved text, and
-- an insertion's anchor can come loose. The words just before it let the editor find the spot
-- again (replacements and deletions already keep their quoted words).
alter table public.suggestions add column if not exists context text not null default '' check (length(context) <= 400);

create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  owner uuid;
  r jsonb;
  n integer := 0;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) = 0 or jsonb_array_length(rows) > 100 then
    raise exception 'Suggest between 1 and 100 edits at a time.';
  end if;
  select owner_id into owner from public.desks where id = l.desk_id;
  for r in select * from jsonb_array_elements(rows) loop
    if (r ->> 'kind') not in ('insert','delete','replace') then raise exception 'bad kind'; end if;
    insert into public.suggestions
      (id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note, context, created_at)
    values (
      gen_random_uuid(), p.id, owner, l.label, 'ai', r ->> 'kind',
      r ->> 'anchor_from', nullif(r ->> 'anchor_to', ''),
      coalesce(r ->> 'quote', ''), coalesce(r ->> 'body', ''), left(coalesce(r ->> 'note', ''), 1000),
      right(coalesce(r ->> 'context', ''), 400),
      -- One call's suggestions share now(); a microsecond apart keeps them in the order sent.
      now() + make_interval(secs => n * 0.000001)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- A date from text, or a clear error naming the bad value.
create or replace function public.connector_date(v text)
returns date language plpgsql immutable as $$
begin
  if v is null or trim(v) = '' then return null; end if;
  return v::date;
exception when others then
  raise exception 'Dates must look like 2026-11-01 (got "%").', v;
end;
$$;

create or replace function public.connector_app_system(v text, fallback text)
returns text language sql immutable as $$
  select case when v in ('common_app','coalition','uc','applytexas','ucas','questbridge','own_portal','other') then v else fallback end;
$$;

create or replace function public.connector_round(v text, fallback text)
returns text language sql immutable as $$
  select case when v in ('ED','ED2','EA','REA','RD','rolling','priority') then v else fallback end;
$$;

-- ─── set up colleges (with their pieces), matching existing ones by name ─────

-- colleges: [{name, app_system, round, deadline, materials_deadline, needs_letters,
--             ai_policy, research, pieces: [{title, prompt, limit_kind, limit_value}]}]
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
begin
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
    end if;
    pout := '[]'::jsonb;
    if jsonb_typeof(c -> 'pieces') = 'array' then
      for p in select * from jsonb_array_elements(c -> 'pieces') loop
        ptitle := coalesce(nullif(left(trim(coalesce(p ->> 'title', '')), 300), ''), 'Untitled');
        select id into pid from public.pieces
         where desk_id = l.desk_id and college_id = cid and lower(title) = lower(ptitle) limit 1;
        pmade := pid is null;
        if pmade then
          insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value)
          values (
            l.desk_id, cid, ptitle, coalesce(p ->> 'prompt', ''),
            case when p ->> 'limit_kind' in ('words','chars','none') then p ->> 'limit_kind'
                 when (p ->> 'limit_value') is not null then 'words' else 'none' end,
            case when (p ->> 'limit_value')::integer > 0 then (p ->> 'limit_value')::integer else null end
          )
          returning id into pid;
        end if;
        pout := pout || jsonb_build_object('title', ptitle, 'piece_id', pid, 'created', pmade);
      end loop;
    end if;
    result := result || jsonb_build_object('name', cname, 'college_id', cid, 'created', made, 'pieces', pout);
  end loop;
  return result;
end;
$$;

-- ─── change or remove colleges and pieces ────────────────────────────────────

-- fields: any of {name, app_system, round, deadline, materials_deadline, needs_letters,
-- ai_policy, research}. Keys left out are unchanged; an empty string clears a date.
create or replace function public.connector_update_college(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  c public.colleges;
begin
  select * into c from public.colleges where id = college and desk_id = l.desk_id for update;
  if not found then raise exception 'No college with that id on this desk.'; end if;
  update public.colleges set
    name = case when fields ? 'name' and trim(fields ->> 'name') <> '' then left(trim(fields ->> 'name'), 200) else name end,
    app_system = case when fields ? 'app_system' then public.connector_app_system(fields ->> 'app_system', app_system) else app_system end,
    round = case when fields ? 'round' then public.connector_round(fields ->> 'round', round) else round end,
    deadline = case when fields ? 'deadline' then public.connector_date(fields ->> 'deadline') else deadline end,
    materials_deadline = case when fields ? 'materials_deadline' then public.connector_date(fields ->> 'materials_deadline') else materials_deadline end,
    needs_letters = case when fields ? 'needs_letters' then (fields ->> 'needs_letters')::boolean else needs_letters end,
    ai_policy = case when fields ? 'ai_policy' then (case when fields ->> 'ai_policy' = 'no_drafting' then 'no_drafting' else 'allowed' end) else ai_policy end,
    research = case when fields ? 'research' then coalesce(fields ->> 'research', '') else research end
  where id = c.id;
end;
$$;

create or replace function public.connector_delete_college(token text, college uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.colleges where id = college and desk_id = l.desk_id;
  if not found then raise exception 'No college with that id on this desk.'; end if;
end;
$$;

-- fields: any of {title, prompt, limit_kind, limit_value, status, notes, college_id}
-- (college_id null moves it to the shared pieces).
create or replace function public.connector_update_piece(token text, piece uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  new_college uuid;
begin
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
    limit_kind = case when fields ->> 'limit_kind' in ('words','chars','none') then fields ->> 'limit_kind' else limit_kind end,
    limit_value = case when fields ? 'limit_value' then (case when (fields ->> 'limit_value')::integer > 0 then (fields ->> 'limit_value')::integer else null end) else limit_value end,
    status = case when fields ->> 'status' in ('not_started','drafting','needs_review','final','submitted') then fields ->> 'status' else status end,
    notes = case when fields ? 'notes' then coalesce(fields ->> 'notes', '') else notes end,
    college_id = new_college
  where id = p.id;
end;
$$;

create or replace function public.connector_delete_piece(token text, piece uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  delete from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
end;
$$;

-- fields: any of {name, about}.
create or replace function public.connector_update_profile(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    display_name = case when fields ? 'name' then left(coalesce(fields ->> 'name', ''), 80) else display_name end,
    about = case when fields ? 'about' then coalesce(fields ->> 'about', '') else about end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

-- The desk overview also carries each college's research and letters flag, and piece prompts.
create or replace function public.connector_desk(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'desk_title', (select title from public.desks where id = l.desk_id),
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
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
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value) order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.connector_date(text) from public, anon, authenticated;
revoke all on function public.connector_app_system(text, text) from public, anon, authenticated;
revoke all on function public.connector_round(text, text) from public, anon, authenticated;
grant execute on function public.connector_set_up_colleges(text, jsonb) to anon, authenticated;
grant execute on function public.connector_update_college(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_college(text, uuid) to anon, authenticated;
grant execute on function public.connector_update_piece(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_delete_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_update_profile(text, jsonb) to anon, authenticated;
