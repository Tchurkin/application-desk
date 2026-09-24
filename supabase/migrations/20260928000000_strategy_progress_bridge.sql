-- Strategy, Progress and the AI bridge.
--
-- Strategy: each college carries admission odds (from the connected AI, or entered by the
-- student; without either, the page falls back to the college's published admission rate from
-- the bundled College Scorecard data), fit, campus life, reputation and cost. Colleges outside
-- the US are described by what decides admission instead of a percentage.
--
-- AI bridge: the website cannot start or read a Claude/ChatGPT conversation. Instead it queues
-- requests on the desk (a question about a piece, "polish this passage", "estimate my odds"),
-- the student tells their connected assistant to handle them, and the assistant answers through
-- the connector. Answers appear on the desk live.

-- ─── strategy fields on colleges ─────────────────────────────────────────────

alter table public.colleges
  add column if not exists scorecard_id integer,
  add column if not exists chance_percent numeric(5,2) check (chance_percent is null or (chance_percent >= 0 and chance_percent <= 100)),
  add column if not exists chance_source text check (chance_source in ('ai','student')),
  add column if not exists chance_note text not null default '',
  add column if not exists fit_rank integer check (fit_rank is null or fit_rank > 0),
  add column if not exists campus_life smallint check (campus_life is null or campus_life between 0 and 10),
  add column if not exists reputation smallint check (reputation is null or reputation between 0 and 10),
  add column if not exists cost_sticker integer check (cost_sticker is null or cost_sticker >= 0),
  add column if not exists cost_net integer check (cost_net is null or cost_net >= 0),
  add column if not exists country text not null default 'US',
  add column if not exists intl_course text not null default '',
  add column if not exists intl_criterion text not null default '',
  add column if not exists intl_cost text not null default '',
  add column if not exists intl_status text not null default '';

-- ─── the student's academic profile (context for odds and writing) ──────────

alter table public.profiles
  add column if not exists gpa text not null default '',
  add column if not exists test_scores text not null default '',
  add column if not exists intended_major text not null default '';

-- ─── pieces: a due date of their own, and alternate versions ─────────────────

alter table public.pieces
  add column if not exists due date,
  add column if not exists variant_of uuid references public.pieces (id) on delete set null;

-- ─── the AI bridge ───────────────────────────────────────────────────────────

create table if not exists public.desk_requests (
  id          uuid primary key default gen_random_uuid(),
  desk_id     uuid not null references public.desks (id) on delete cascade,
  piece_id    uuid references public.pieces (id) on delete cascade,
  -- ask: a question; polish: rewordings of `selection` (answered as suggestions); odds: estimate
  -- admission odds for the colleges (answered with set_college_strategy).
  kind        text not null check (kind in ('ask','polish','odds')),
  prompt      text not null default '',
  selection   text not null default '',
  status      text not null default 'pending' check (status in ('pending','answered','dismissed')),
  answer      text not null default '',
  answered_by text not null default '',
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists desk_requests_desk_idx on public.desk_requests (desk_id, status, created_at);

alter table public.desk_requests enable row level security;
create policy "owner reads requests" on public.desk_requests
  for select using (public.is_desk_owner(desk_id));
create policy "owner makes requests" on public.desk_requests
  for insert with check (public.is_desk_owner(desk_id) and status = 'pending' and answer = '');
create policy "owner dismisses requests" on public.desk_requests
  for update using (public.is_desk_owner(desk_id)) with check (public.is_desk_owner(desk_id));
create policy "owner deletes requests" on public.desk_requests
  for delete using (public.is_desk_owner(desk_id));

alter publication supabase_realtime add table public.desk_requests;

-- Progress and Board follow pieces live (a status changed on one screen moves everywhere).
alter publication supabase_realtime add table public.pieces;

-- Requests waiting for the assistant, oldest first.
create or replace function public.connector_requests(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.kind, 'piece_id', r.piece_id,
      'piece_title', (select title from public.pieces where id = r.piece_id),
      'prompt', r.prompt, 'selection', r.selection, 'created_at', r.created_at) order by r.created_at)
    from public.desk_requests r
    where r.desk_id = l.desk_id and r.status = 'pending'), '[]'::jsonb);
end;
$$;

create or replace function public.connector_answer_request(token text, request uuid, answer_text text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.desk_requests
     set status = 'answered', answer = coalesce(answer_text, ''), answered_by = l.label, answered_at = now()
   where id = request and desk_id = l.desk_id;
  if not found then raise exception 'No request with that id on this desk.'; end if;
end;
$$;

-- Strategy fields for one college, set by the assistant. Keys left out are unchanged.
-- fields: any of {chance_percent, chance_note, fit_rank, campus_life, reputation, cost_sticker,
-- cost_net, country, intl_course, intl_criterion, intl_cost, intl_status, scorecard_id}.
create or replace function public.connector_set_strategy(token text, college uuid, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  n numeric;
begin
  if not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'No college with that id on this desk.';
  end if;
  update public.colleges set
    chance_percent = case when fields ? 'chance_percent' then (fields ->> 'chance_percent')::numeric else chance_percent end,
    chance_source = case when fields ? 'chance_percent' then (case when fields ->> 'chance_percent' is null then null else 'ai' end) else chance_source end,
    chance_note = case when fields ? 'chance_note' then coalesce(fields ->> 'chance_note', '') else chance_note end,
    fit_rank = case when fields ? 'fit_rank' then (fields ->> 'fit_rank')::integer else fit_rank end,
    campus_life = case when fields ? 'campus_life' then (fields ->> 'campus_life')::smallint else campus_life end,
    reputation = case when fields ? 'reputation' then (fields ->> 'reputation')::smallint else reputation end,
    cost_sticker = case when fields ? 'cost_sticker' then (fields ->> 'cost_sticker')::integer else cost_sticker end,
    cost_net = case when fields ? 'cost_net' then (fields ->> 'cost_net')::integer else cost_net end,
    country = case when fields ? 'country' and trim(fields ->> 'country') <> '' then left(trim(fields ->> 'country'), 60) else country end,
    intl_course = case when fields ? 'intl_course' then coalesce(fields ->> 'intl_course', '') else intl_course end,
    intl_criterion = case when fields ? 'intl_criterion' then coalesce(fields ->> 'intl_criterion', '') else intl_criterion end,
    intl_cost = case when fields ? 'intl_cost' then coalesce(fields ->> 'intl_cost', '') else intl_cost end,
    intl_status = case when fields ? 'intl_status' then coalesce(fields ->> 'intl_status', '') else intl_status end,
    scorecard_id = case when fields ? 'scorecard_id' then (fields ->> 'scorecard_id')::integer else scorecard_id end
  where id = college;
end;
$$;

-- The student's academic profile, set by the assistant. fields: any of {gpa, test_scores, intended_major}.
create or replace function public.connector_update_academics(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    gpa = case when fields ? 'gpa' then coalesce(fields ->> 'gpa', '') else gpa end,
    test_scores = case when fields ? 'test_scores' then coalesce(fields ->> 'test_scores', '') else test_scores end,
    intended_major = case when fields ? 'intended_major' then coalesce(fields ->> 'intended_major', '') else intended_major end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

grant execute on function public.connector_requests(text) to anon, authenticated;
grant execute on function public.connector_answer_request(text, uuid, text) to anon, authenticated;
grant execute on function public.connector_set_strategy(text, uuid, jsonb) to anon, authenticated;
grant execute on function public.connector_update_academics(text, jsonb) to anon, authenticated;
