-- Claude (or ChatGPT) watching the desk from a chat the student already has open.
--
-- The website can't push a message into a Claude chat. Instead the student says "watch my
-- Application Desk" once; the assistant calls watch_desk, which waits on the server for new
-- requests and returns them as they arrive, then calls it again. watched_at records when it
-- last checked, so the website can show "Claude is watching" or how to start it.

alter table public.connector_links add column if not exists watched_at timestamptz;

-- Mark the link as watching now, and return the requests waiting (oldest first).
create or replace function public.connector_watch(token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  l public.connector_links := public.connector_link(token);
begin
  update public.connector_links set watched_at = now() where id = l.id;
  return public.connector_requests(token);
end;
$$;

grant execute on function public.connector_watch(text) to anon, authenticated;
