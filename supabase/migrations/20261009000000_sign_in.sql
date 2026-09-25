-- Signing in with an emailed code or with Google.
--
-- Braxton's call (9/24/26, team request 18): students sign in with a 6-digit code emailed to them,
-- or with Google, instead of a password. A student who starts with Google gets their first name
-- from their Google account.

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  -- Anonymous visitors (parents on a link) get no desk of their own.
  if coalesce(new.is_anonymous, false) then
    return new;
  end if;
  insert into public.profiles (id, display_name)
    values (new.id, left(coalesce(
      nullif(btrim(m ->> 'display_name'), ''),
      nullif(btrim(m ->> 'given_name'), ''),
      nullif(split_part(btrim(coalesce(m ->> 'full_name', m ->> 'name', '')), ' ', 1), ''),
      ''), 80));
  insert into public.desks (owner_id) values (new.id);
  return new;
end;
$$;

-- With codes, anyone could sign up with a student's email and a password before the student ever
-- arrives, then keep using that password once the student confirms the account with a code or
-- Google. A password set while the email was unconfirmed is dropped the moment it's confirmed.
-- (Confirm email must be on for this to hold: docs/sign-in.md.)
create or replace function public.forget_unconfirmed_password()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;
drop trigger if exists forget_unconfirmed_password on auth.users;
create trigger forget_unconfirmed_password
  before update of email_confirmed_at on auth.users
  for each row execute function public.forget_unconfirmed_password();
