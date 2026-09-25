/*
 * How students sign in. An emailed 6-digit code (no password) once the site can send email to
 * anyone (a custom SMTP sender, see docs/sign-in.md); until then, email and password. "Continue
 * with Google" once Google is set up. Both are switched on in the site's environment:
 *   NEXT_PUBLIC_SIGN_IN=code
 *   NEXT_PUBLIC_GOOGLE_SIGNIN=on
 * Parents on a share link never sign in: they only type their name.
 */

export const codeSignIn = process.env.NEXT_PUBLIC_SIGN_IN === "code";
export const googleSignIn = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === "on";

/** The code's length (supabase/config.toml otp_length; set the same in the dashboard). */
export const CODE_LENGTH = 6;
