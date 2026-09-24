import Link from "next/link";
import { signIn, signUp } from "./actions";

export default async function LoginPage(props: PageProps<"/login">) {
  const q = await props.searchParams;
  const signup = q.mode === "signup";
  const error = typeof q.error === "string" ? q.error : null;
  const notice = q.notice === "check-email" ? "Check your email to confirm your account, then sign in." : null;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <Link href="/" className="mb-8 text-sm text-muted">
        ← Margin
      </Link>
      <h1 className="mb-6 font-serif text-3xl">{signup ? "Start your desk" : "Sign in"}</h1>
      {error && <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p className="mb-4 rounded-md bg-accent-soft px-3 py-2 text-sm">{notice}</p>}
      <form action={signup ? signUp : signIn} className="flex flex-col gap-4">
        {signup && (
          <div>
            <label className="label" htmlFor="name">Your first name</label>
            <input className="field" id="name" name="name" required autoComplete="given-name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input className="field" id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            className="field"
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={signup ? "new-password" : "current-password"}
          />
        </div>
        <button className="btn btn-primary mt-2" type="submit">
          {signup ? "Create my desk" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-sm text-muted">
        {signup ? (
          <>Already have a desk? <Link className="text-accent underline" href="/login">Sign in</Link></>
        ) : (
          <>New here? <Link className="text-accent underline" href="/login?mode=signup">Start a desk</Link></>
        )}
      </p>
    </main>
  );
}
