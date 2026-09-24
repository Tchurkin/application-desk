-- Editing and Suggesting for everyone on a piece.
--
-- Braxton's call (9/24/26): anyone who can suggest on a desk (the student, and people with a
-- "can suggest" link) can switch between Suggesting and Editing. In Editing they change the text
-- directly. Read-only links still only read. The student still decides on suggestions.

-- Who may change a piece's text directly.
create or replace function public.can_edit_text(d uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_desk_owner(d) or public.member_role(d) = 'suggest';
$$;

drop policy if exists "add updates" on public.piece_updates;
create policy "add updates" on public.piece_updates
  for insert with check (public.can_edit_text(public.piece_desk(piece_id)));

-- The board's word counts, kept current by whoever is editing (the rest of a piece's fields stay
-- the student's).
create or replace function public.set_piece_text_stats(piece uuid, plain text, words integer, chars integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_text(public.piece_desk(piece)) then raise exception 'not allowed'; end if;
  update public.pieces
     set plain_text = coalesce(plain, ''), word_count = greatest(0, coalesce(words, 0)), char_count = greatest(0, coalesce(chars, 0))
   where id = piece;
end;
$$;
revoke all on function public.set_piece_text_stats(uuid, text, integer, integer) from public, anon;
grant execute on function public.set_piece_text_stats(uuid, text, integer, integer) to authenticated;

-- The student resolves every suggestion, including ones they made themselves in Suggesting mode,
-- and can still reword their own while it is open.
create or replace function public.check_suggestion_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d uuid := public.piece_desk(old.piece_id);
  content_changed boolean := new.kind <> old.kind or new.anchor_from <> old.anchor_from
    or new.anchor_to is distinct from old.anchor_to or new.quote <> old.quote or new.body <> old.body
    or new.note <> old.note;
begin
  if new.id <> old.id or new.piece_id <> old.piece_id or new.author_id <> old.author_id
     or new.source <> old.source then
    raise exception 'those fields cannot change';
  end if;
  if public.is_desk_owner(d) then
    if old.author_id = auth.uid() and old.source <> 'ai' and old.status = 'open' and new.status = 'open' then
      null; -- the student rewording their own open suggestion
    else
      if content_changed then
        raise exception 'the student accepts or declines, and does not edit, a suggestion';
      end if;
      new.resolved_at := case when new.status = 'open' then null else now() end;
      new.resolved_by := case when new.status = 'open' then null else auth.uid() end;
    end if;
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
