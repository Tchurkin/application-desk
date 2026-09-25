# Signing in with an emailed code, or with Google

Students can sign in without a password: they type their email, get a 6-digit code, and type
it in. They can also use "Continue with Google". Parents on a share link never sign in; they
only type their name.

Both are off until the hosted project is ready, and the site keeps email and password until
then. Codes need an email sender that reaches anyone: Supabase's built-in email only delivers to
the project's own team.

## 1. An email sender (custom SMTP)

1. Make an account with an email provider that offers SMTP (for example Resend), and verify the
   domain the emails will come from.
2. Supabase dashboard -> Authentication -> Emails -> SMTP Settings: turn on custom SMTP and enter
   the provider's host, port, user and password, and a sender address on that domain.
3. Authentication -> Rate Limits: raise "emails per hour" above the default.

## 2. The code in the email

Authentication -> Emails -> Templates. In both **Magic Link** and **Confirm signup**, set the
subject to "Your sign-in code" and the body to the contents of
[`supabase/templates/sign-in-code.html`](../supabase/templates/sign-in-code.html). The email
must show `{{ .Token }}` (the code), not a link: school email scanners open links, which uses
them up, and a link opened on a phone signs in the phone instead of the laptop.

Authentication -> Providers -> Email: check that the email OTP length is 6.

## 3. Turn it on

1. Authentication -> Sign In / Providers -> Email: turn **Confirm email** on. Without it, anyone
   could make an account in a student's name before the student does. (Migration 20261009 also
   drops any password set on an account before its email was confirmed.)
2. Authentication -> Rate Limits: raise "sign ups and sign ins" and "token verifications" too.
   Codes are sent and checked from each student's browser, so these count per student.
3. In Vercel -> the project -> Settings -> Environment Variables, add `NEXT_PUBLIC_SIGN_IN` =
   `code`, then redeploy. Everyone signs in with a code from then on, including accounts made with
   a password.

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
