import Link from "next/link";
import type { ReactNode } from "react";

/* The privacy policy and terms: plain pages anyone can read, signed in or not. */

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <nav className="flex gap-4 text-sm text-muted">
        <Link href="/">Average App</Link>
        <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/terms" className="hover:text-ink">Terms</Link>
      </nav>
      <h1 className="mt-6 font-serif text-4xl">{title}</h1>
      <p className="mt-2 text-sm text-muted">Last updated {updated}</p>
      <div className="mt-6 flex flex-col gap-3 text-[15px] leading-relaxed">{children}</div>
    </main>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="mt-6 font-serif text-2xl">{children}</h2>;
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-1.5 pl-5">{children}</ul>;
}

/** "Privacy · Terms", for the foot of pages people land on before signing in. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <Link className="underline underline-offset-2" href="/privacy">
        Privacy
      </Link>{" "}
      ·{" "}
      <Link className="underline underline-offset-2" href="/terms">
        Terms
      </Link>
    </span>
  );
}
