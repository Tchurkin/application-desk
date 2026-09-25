-- Run once, when the site switches to signing in with a code (docs/sign-in.md, step 3), after
-- the migrations. Not a migration: while students still use passwords it would lock them out
-- (see migration 20261011).
--
-- With codes, anyone could sign up with a student's email and a password before the student ever
-- arrives, then keep using that password once the student confirms the account with a code or
-- Google. A password set while the email was unconfirmed is dropped the moment it's confirmed.
-- (Confirm email must be on for this to hold.) The function is from migration 20261009.

drop trigger if exists forget_unconfirmed_password on auth.users;
create trigger forget_unconfirmed_password
  before update of email_confirmed_at on auth.users
  for each row execute function public.forget_unconfirmed_password();
