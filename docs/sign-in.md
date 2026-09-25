# Signing in with an emailed code, or with Google

Students can sign in without a password: they type their email, get a 6-digit code, and type
it in. They can also use "Continue with Google". Parents on a share link never sign in; they
only type their name.

Both are off until the hosted project is ready, and the site keeps email and password until
then. Codes need an email sender that reaches anyone: Supabase's built-in email only delivers to
the project's own team.

Everything but the first section needs a domain, and goes in order: 1, 2, 3. Don't do step 3
before steps 1 and 2: new students would get no email, or a link instead of a code.

## Any time

- Authentication -> Sign In / Providers -> Email: check that the email OTP length is 6.
- Authentication -> Rate Limits: raise "sign ups and sign ins" and "token verifications". Codes
  are sent and checked from each student's browser, so these count per student.

## 1. An email sender (custom SMTP)

1. Make an account with an email provider that offers SMTP (for example Resend), and verify the
   domain the emails will come from (the provider lists DNS records to add at the domain's
   registrar).
2. Supabase dashboard -> Authentication -> Emails -> SMTP Settings: turn on custom SMTP and enter
   the provider's host, port, user and password, and a sender address on that domain.
3. Authentication -> Rate Limits: raise "emails per hour" above the default.

## 2. The code in the email (after step 1)

A free project made since June 2026 can only edit its email templates once custom SMTP is on.

Authentication -> Emails -> Templates. In both **Magic Link** and **Confirm signup**, set the
subject to "Your sign-in code" and the body to the contents of
[`supabase/templates/sign-in-code.html`](../supabase/templates/sign-in-code.html). The email
must show `{{ .Token }}` (the code), not a link: school email scanners open links, which uses
them up, and a link opened on a phone signs in the phone instead of the laptop.

## 3. Turn it on (after steps 1 and 2)

1. Authentication -> Sign In / Providers -> Email: turn **Confirm email** on. Without it, anyone
   could make an account in a student's name before the student does.
2. SQL Editor: run [`supabase/sign-in-code.sql`](../supabase/sign-in-code.sql) (after the
   migrations). A password someone set on a student's email before the student confirmed it
   stops working when they do. It is not a migration because it would lock password users out.
3. In Vercel -> the project -> Settings -> Environment Variables, add `NEXT_PUBLIC_SIGN_IN` =
   `code`, then redeploy. Everyone signs in with a code from then on, including accounts made with
   a password.
4. Try it: sign out, sign in with your own email, and check the code arrives (and not in spam).

## 4. Google (optional)

1. Google Cloud console -> APIs & Services -> Credentials -> Create credentials -> OAuth client
   ID, type "Web application". Authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`.
2. Supabase dashboard -> Authentication -> Sign In / Providers -> Google: turn it on and paste the
   client ID and secret.
3. Authentication -> URL Configuration: add `https://<your-site>/auth/callback` to the redirect
   URLs.
4. In Vercel, add `NEXT_PUBLIC_GOOGLE_SIGNIN` = `on` and redeploy.

Some school Google accounts don't let students under 18 sign in to other sites; the emailed code
always works.
