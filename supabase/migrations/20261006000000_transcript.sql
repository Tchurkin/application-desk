-- The transcript: pasted on the Profile page, read by the counselor into the academics.
--
-- Braxton's call (9/24/26): academics live on the Profile page, not in Settings, and the
-- student can paste their transcript for the counselor to read, which fills in their GPA,
-- class rank and coursework. The academics gain those two fields; requests gain a kind.

alter table public.profiles
  add column if not exists class_rank text not null default '',
  add column if not exists coursework text not null default '';

alter table public.desk_requests drop constraint if exists desk_requests_kind_check;
alter table public.desk_requests add constraint desk_requests_kind_check
  check (kind in ('ask','polish','odds','interview','chat','transcript'));

-- The student's academic profile, set by the assistant. fields: any of {gpa, test_scores,
-- intended_major, class_rank, coursework}; the rest stay as they are.
create or replace function public.connector_update_academics(token text, fields jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.profiles pr set
    gpa = case when fields ? 'gpa' then left(coalesce(fields ->> 'gpa', ''), 80) else gpa end,
    test_scores = case when fields ? 'test_scores' then left(coalesce(fields ->> 'test_scores', ''), 200) else test_scores end,
    intended_major = case when fields ? 'intended_major' then left(coalesce(fields ->> 'intended_major', ''), 200) else intended_major end,
    class_rank = case when fields ? 'class_rank' then left(coalesce(fields ->> 'class_rank', ''), 80) else class_rank end,
    coursework = case when fields ? 'coursework' then left(coalesce(fields ->> 'coursework', ''), 4000) else coursework end
  from public.desks d
  where d.id = l.desk_id and pr.id = d.owner_id;
end;
$$;

-- Everything the assistant needs to estimate odds: each college's strategy fields and the
-- student's academic profile.
create or replace function public.connector_strategy(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  return jsonb_build_object(
    'student', (select jsonb_build_object('name', p.display_name, 'about', p.about, 'gpa', p.gpa,
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major,
                                          'class_rank', p.class_rank, 'coursework', p.coursework)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'colleges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'round', c.round, 'deadline', c.deadline, 'scorecard_id', c.scorecard_id,
        'chance_percent', c.chance_percent, 'chance_source', c.chance_source, 'chance_note', c.chance_note,
        'fit_rank', c.fit_rank, 'campus_life', c.campus_life, 'reputation', c.reputation,
        'cost_sticker', c.cost_sticker, 'cost_net', c.cost_net, 'country', c.country,
        'intl_course', c.intl_course, 'intl_criterion', c.intl_criterion, 'intl_cost', c.intl_cost,
        'intl_status', c.intl_status, 'research', c.research) order by c.name)
      from public.colleges c where c.desk_id = l.desk_id), '[]'::jsonb)
  );
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
                                          'test_scores', p.test_scores, 'intended_major', p.intended_major,
                                          'class_rank', p.class_rank, 'coursework', p.coursework)
                  from public.desks d join public.profiles p on p.id = d.owner_id where d.id = l.desk_id),
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'body', s.body, 'updated_at', s.updated_at)
                       order by s.sort, s.created_at)
      from public.profile_sections s where s.desk_id = l.desk_id), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.connector_update_academics(text, jsonb) to anon, authenticated;
grant execute on function public.connector_strategy(text) to anon, authenticated;
grant execute on function public.connector_profile(text) to anon, authenticated;
