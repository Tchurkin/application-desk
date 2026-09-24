import Link from "next/link";
import { DeskNav } from "@/components/desk-nav";
import { requireDesk } from "@/lib/supabase/server";

export default async function DeskLayout({ children }: LayoutProps<"/desk">) {
  const { desk } = await requireDesk();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-2">
        <Link href="/desk" className="font-serif text-lg">{desk.title}</Link>
        <DeskNav base="/desk" owner />
        <form action="/auth/signout" method="post">
          <button className="text-sm text-muted hover:text-ink" type="submit">Sign out</button>
        </form>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
