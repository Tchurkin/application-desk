-- The site is Average App now (Braxton's call, 9/25/26). Two messages the database hands to the
-- student's assistant, which it passes on to them, named the old one. Same functions otherwise.
-- ("not valid" stays: the counselor and its route look for it.)

create or replace function public.connector_link(token text)
returns public.connector_links language plpgsql security definer set search_path = public, extensions as $$
declare
  l public.connector_links;
begin
  select * into l from public.connector_links
   where token_hash = encode(digest(token, 'sha256'), 'hex') and revoked_at is null;
  if not found then raise exception 'This connector link is not valid. Make a new one in Average App → Settings.'; end if;
  update public.connector_links set last_used_at = now()
   where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return l;
end;
$$;
revoke all on function public.connector_link(text) from public, anon, authenticated;

create or replace function public.connector_allow(token text, what text)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  if what = 'manage' and not l.can_manage then
    raise exception 'The student hasn''t allowed % to add, change or remove colleges and pieces (details, prompts, limits, due dates). Tell them what you would change; they can allow it in Average App → Settings.', l.label;
  elsif what = 'edit' and l.essay_access <> 'edit' then
    raise exception 'The student hasn''t allowed % to change essay text directly.%', l.label,
      case when l.essay_access = 'suggest' then ' Use suggest_edits instead: the changes wait for them to accept.' else ' Give advice in your answer instead.' end;
  elsif what = 'suggest' and l.essay_access = 'read' then
    raise exception 'The student has allowed % to read their essays but not to suggest edits. Give advice in your answer instead.', l.label;
  end if;
end;
$$;
revoke all on function public.connector_allow(text, text) from public, anon, authenticated;
