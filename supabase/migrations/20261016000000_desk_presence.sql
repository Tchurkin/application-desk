-- Where everyone is on a desk.
--
-- Braxton's call (9/26/26): the Write page's list of colleges and pieces shows where the people
-- working on the desk are. Each open piece says so on a private channel for its desk
-- ("desk:<id>"), which only people who can read the desk may join, like the channel each piece
-- already has for cursors. The same check covers both.

create or replace function public.can_use_piece_topic(topic text)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if topic ~ '^piece:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_read_desk(public.piece_desk(substring(topic from 7)::uuid));
  end if;
  if topic ~ '^desk:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return public.can_read_desk(substring(topic from 6)::uuid);
  end if;
  return false;
end;
$$;
