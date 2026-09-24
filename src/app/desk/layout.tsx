import Link from "next/link";
import { requireDesk } from "@/lib/supabase/server";

export default async function DeskLayout({ children }: LayoutProps<"/desk">) {
  const { desk } = await requireDesk();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-line bg-panel px-4 py-2.5">
        <Link href="/desk" className="font-serif text-lg">{desk.title}</Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link href="/desk" className="text-muted hover:text-ink">Board</Link>
          <Link href="/desk/settings" className="text-muted hover:text-ink">Settings</Link>
          <form action="/auth/signout" method="post">
            <button className="text-muted hover:text-ink" type="submit">Sign out</button>
          </form>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
