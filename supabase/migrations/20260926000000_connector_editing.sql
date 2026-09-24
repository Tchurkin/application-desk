-- The connector can write, not only suggest.
--
-- Braxton's call (9/24/26): the AI follows the student's instructions. Asked for feedback it
-- suggests; asked to draft or rewrite, it writes the piece directly. No length caps, and a
-- college's "no AI drafting" flag is information passed to the AI, not a block.
--
-- A direct write first saves the piece's current text as a version, so History can always
-- bring the student's words back.

-- ─── suggestions: any length, any college ────────────────────────────────────

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

-- ─── direct writes ───────────────────────────────────────────────────────────

-- Append one Yjs update (computed by the connector server from the piece's own document),
-- after saving the text as it was. `before` is the editor JSON and text before the change;
-- `after_text` feeds the board's counts.
create or replace function public.connector_write(
  token text, piece uuid, yjs_update text,
  before_json jsonb, before_text text, after_text text, after_words integer, after_chars integer
)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  p public.pieces;
begin
  select * into p from public.pieces where id = piece and desk_id = l.desk_id for update;
  if not found then raise exception 'No piece with that id on this desk.'; end if;
  if coalesce(yjs_update, '') = '' then return; end if;
  if length(trim(coalesce(before_text, ''))) > 0 then
    insert into public.piece_versions (piece_id, author, content, plain_text, words, size)
    values (
      p.id, 'Before ' || l.label || '''s edit', before_json, before_text,
      coalesce(array_length(regexp_split_to_array(trim(before_text), '\s+'), 1), 0),
      length(before_json::text)
    );
  end if;
  insert into public.piece_updates (piece_id, client_id, "update")
  values (p.id, 'connector:' || l.label, yjs_update);
  update public.pieces
     set plain_text = coalesce(after_text, plain_text),
         word_count = coalesce(after_words, word_count),
         char_count = coalesce(after_chars, char_count),
         status = case when status = 'not_started' and length(trim(coalesce(after_text, ''))) > 0 then 'drafting' else status end
   where id = p.id;
end;
$$;

-- Make a new piece (e.g. a supplemental) for one of the desk's colleges, or shared (null).
create or replace function public.connector_create_piece(
  token text, college uuid, piece_title text, piece_prompt text, piece_limit_kind text, piece_limit_value integer
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
  new_id uuid;
begin
  if college is not null and not exists (select 1 from public.colleges where id = college and desk_id = l.desk_id) then
    raise exception 'No college with that id on this desk.';
  end if;
  insert into public.pieces (desk_id, college_id, title, prompt, limit_kind, limit_value)
  values (
    l.desk_id, college,
    coalesce(nullif(left(trim(piece_title), 300), ''), 'Untitled'),
    coalesce(piece_prompt, ''),
    case when piece_limit_kind in ('words','chars','none') then piece_limit_kind else 'words' end,
    case when piece_limit_value > 0 then piece_limit_value else null end
  )
  returning id into new_id;
  return new_id;
end;
$$;

grant execute on function public.connector_write(text, uuid, text, jsonb, text, text, integer, integer) to anon, authenticated;
grant execute on function public.connector_create_piece(text, uuid, text, text, text, integer) to anon, authenticated;
