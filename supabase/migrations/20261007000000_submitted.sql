-- Submitting a whole application.
--
-- Braxton's call (9/24/26): a college's application is submitted at once, with one button on the
-- board, not piece by piece. When it's submitted its pieces are marked submitted too; the board
-- folds the college away and, after a few days, files it under Submitted.

alter table public.colleges add column if not exists submitted_at timestamptz;

-- Colleges already submitted piece by piece stay submitted, dated by their last piece's change
-- (so ones sent long ago are filed away at once).
update public.colleges c
   set submitted_at = (select max(p.updated_at) from public.pieces p where p.college_id = c.id)
 where c.submitted_at is null
   and exists (select 1 from public.pieces p where p.college_id = c.id)
   and not exists (select 1 from public.pieces p where p.college_id = c.id and p.status <> 'submitted');

-- The board follows colleges live (a submit on another screen, or by the counselor).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'colleges') then
    alter publication supabase_realtime add table public.colleges;
  end if;
end;
$$;

-- Submit a college's whole application through the connector (or take it back), as the board's
-- button does: submitted, every piece is marked submitted; taken back, they return to final.
create or replace function public.connector_submit_college(token text, college uuid, submitted boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  perform public.connector_allow(token, 'manage');
  update public.colleges
     set submitted_at = case when submitted then coalesce(submitted_at, now()) else null end
   where id = college and desk_id = l.desk_id;
  if not found then raise exception 'No college with that id on this desk.'; end if;
  if submitted then
    update public.pieces set status = 'submitted' where college_id = college and status <> 'submitted';
  else
    update public.pieces set status = 'final' where college_id = college and status = 'submitted';
  end if;
end;
$$;

-- The desk overview, with each piece's due date, whether each application is submitted, and what
-- this connector is allowed to do.
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
        'has_research', length(c.research) > 0, 'submitted_at', c.submitted_at) order by c.deadline nulls last, c.name)
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

grant execute on function public.connector_submit_college(text, uuid, boolean) to anon, authenticated;
grant execute on function public.connector_desk(text) to anon, authenticated;
