-- Application Desk: milestone 3 (Claude and ChatGPT as counselors).
--
-- A student connects Claude or ChatGPT to their desk with a secret connector link (an MCP
-- server URL). The assistant can read the desk and propose edits, which arrive as suggestions
-- the student accepts or declines. It runs on the student's own Claude or ChatGPT plan.
--
-- The connector talks to the database only through the functions below, keyed by the link's
-- token. It never holds a service key, and it can never write a piece's text.

-- Why a suggestion was made (shown under it). AI suggestions always carry one.
alter table public.suggestions add column note text not null default '' check (length(note) <= 1000);

-- ─── connector links ─────────────────────────────────────────────────────────

create table public.connector_links (
  id           uuid primary key default gen_random_uuid(),
  desk_id      uuid not null references public.desks (id) on delete cascade,
  -- sha256 of the token in the URL; the token is shown once and never stored.
  token_hash   text not null unique,
  -- Who the suggestions are credited to, e.g. 'Claude' or 'ChatGPT'.
  label        text not null default 'Claude' check (length(label) between 1 and 40),
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index connector_links_desk_idx on public.connector_links (desk_id);

alter table public.connector_links enable row level security;
create policy "owner reads connector links" on public.connector_links
  for select using (public.is_desk_owner(desk_id));
create policy "owner revokes connector links" on public.connector_links
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));

create or replace function public.create_connector_link(d uuid, link_label text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  token text;
begin
  if not public.is_desk_owner(d) then raise exception 'not allowed'; end if;
  token := translate(encode(gen_random_bytes(24), 'base64'), '+/=', '-_');
  insert into public.connector_links (desk_id, token_hash, label)
  values (d, encode(digest(token, 'sha256'), 'hex'), coalesce(nullif(left(trim(link_label), 40), ''), 'Claude'));
  return token;
end;
$$;
revoke all on function public.create_connector_link(uuid, text) from public, anon;
grant execute on function public.create_connector_link(uuid, text) to authenticated;

-- The live link for a token, or nothing.
create or replace function public.connector_link(token text)
returns public.connector_links language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.connector_links;
begin
  select * into l from public.connector_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'This connector link is not valid. Make a new one in Application Desk → Settings.'; end if;
  update public.connector_links set last_used_at = now()
   where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return l;
end;
$$;
revoke all on function public.connector_link(text) from public, anon, authenticated;

-- ─── what the connector may read ─────────────────────────────────────────────

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
        'ai_policy', c.ai_policy, 'needs_letters', c.needs_letters) order by c.deadline nulls last, c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'college_id', p.college_id, 'title', p.title, 'status', p.status,
        'word_count', p.word_count, 'limit_kind', p.limit_kind, 'limit_value', p.limit_value) order by p.sort, p.created_at)
      from public.pieces p where p.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.connector_piece(token text, piece uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  return jsonb_build_object(
    'id', p.id, 'title', p.title, 'prompt', p.prompt, 'status', p.status, 'notes', p.notes,
    'limit_kind', p.limit_kind, 'limit_value', p.limit_value,
    'doc_state', p.doc_state,
    'updates', coalesce((select jsonb_agg(u."update" order by u.id) from public.piece_updates u where u.piece_id = p.id), '[]'::jsonb),
    'college', (select jsonb_build_object('id', c.id, 'name', c.name, 'ai_policy', c.ai_policy,
                                          'deadline', c.deadline, 'research', c.research)
                  from public.colleges c where c.id = p.college_id),
    'other_pieces', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'prompt', o.prompt,
                                          'text', o.plain_text, 'status', o.status) order by o.sort, o.created_at)
      from public.pieces o
      where o.desk_id = l.desk_id and o.id <> p.id
        and o.college_id is not distinct from p.college_id), '[]'::jsonb),
    'open_suggestions', coalesce((
      select jsonb_agg(jsonb_build_object('author', s.author_name, 'source', s.source, 'kind', s.kind,
                                          'quote', s.quote, 'body', s.body, 'note', s.note) order by s.created_at)
      from public.suggestions s where s.piece_id = p.id and s.status = 'open'), '[]'::jsonb),
    'student', (select jsonb_build_object('name', pr.display_name, 'about', pr.about)
                  from public.desks d join public.profiles pr on pr.id = d.owner_id where d.id = l.desk_id)
  );
end;
$$;

-- ─── what the connector may write: suggestions, and nothing else ─────────────

-- rows: [{kind, anchor_from, anchor_to, quote, body, note}]. Anchors are computed by the
-- connector server from the piece's own document.
create or replace function public.connector_add_suggestions(token text, piece uuid, rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
  owner uuid;
  policy text;
  r jsonb;
  n integer := 0;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  select c.ai_policy into policy from public.colleges c where c.id = p.college_id;
  if policy = 'no_drafting' then
    raise exception 'This college does not allow AI help with drafting, so edits can''t be suggested here. You can still ask questions and check facts.';
  end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 25 then
    raise exception 'Suggest between 1 and 25 edits at a time.';
  end if;
  select owner_id into owner from public.desks where id = l.desk_id;
  for r in select * from jsonb_array_elements(rows) loop
    if (r ->> 'kind') not in ('insert','delete','replace') then raise exception 'bad kind'; end if;
    if length(coalesce(r ->> 'body', '')) > 1200 then
      raise exception 'Each suggestion can add at most about 200 words. Suggest smaller edits.';
    end if;
    insert into public.suggestions
      (id, piece_id, author_id, author_name, source, kind, anchor_from, anchor_to, quote, body, note)
    values (
      gen_random_uuid(), p.id, owner, l.label, 'ai', r ->> 'kind',
      r ->> 'anchor_from', nullif(r ->> 'anchor_to', ''),
      coalesce(r ->> 'quote', ''), coalesce(r ->> 'body', ''), left(coalesce(r ->> 'note', ''), 1000)
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.connector_desk(text) to anon, authenticated;
grant execute on function public.connector_piece(text, uuid) to anon, authenticated;
grant execute on function public.connector_add_suggestions(text, uuid, jsonb) to anon, authenticated;

-- ─── the student resolves every suggestion, including ones credited to their own account ──

create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) and (old.author_id <> auth.uid() or old.source = 'ai') then
    if new.kind <> old.kind or new.anchor_from <> old.anchor_from
       or new.anchor_to is distinct from old.anchor_to
       or new.quote <> old.quote or new.body <> old.body or new.note <> old.note then
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
